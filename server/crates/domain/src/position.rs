//! Порядок элементов: колонки, задачи, подзадачи. Позиции дробные (docs/DATA-MODEL.md):
//! при вставке между двумя соседями берётся среднее. Если зазор стал меньше `MIN_GAP`, позиции всех
//! соседей пересчитываются целыми числами с шагом `STEP`.

/// Шаг между позициями при пересчёте и при вставке в начало или конец
pub const STEP: f64 = 1024.0;
/// Минимальный зазор между соседями, после которого нужен пересчёт
pub const MIN_GAP: f64 = 1e-6;

#[derive(Debug, Clone, PartialEq)]
pub enum Placement<K> {
    /// Достаточно записать позицию перемещаемому элементу
    One(f64),
    /// Места не осталось: новые позиции получают все, включая перемещаемый, в порядке следования
    All(Vec<(K, f64)>),
}

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
#[error("элемент, перед которым нужно вставить, не найден среди соседей")]
pub struct BeforeNotFound;

/// Куда поставить `moved`.
///
/// `siblings` — соседи по возрастанию позиции, без самого `moved`. `before` — сосед, перед которым
/// нужно встать; `None` — в конец.
pub fn place<K: Copy + PartialEq>(
    siblings: &[(K, f64)],
    moved: K,
    before: Option<K>,
) -> Result<Placement<K>, BeforeNotFound> {
    let index = match before {
        None => siblings.len(),
        Some(b) => siblings.iter().position(|(k, _)| *k == b).ok_or(BeforeNotFound)?,
    };
    let prev = index.checked_sub(1).map(|i| siblings[i].1);
    let next = siblings.get(index).map(|s| s.1);

    Ok(match slot(prev, next) {
        Some(position) => Placement::One(position),
        None => {
            let mut keys: Vec<K> = siblings.iter().map(|s| s.0).collect();
            keys.insert(index, moved);
            Placement::All(keys.into_iter().enumerate().map(|(i, k)| (k, STEP * (i as f64 + 1.0))).collect())
        }
    })
}

/// Позиция между `prev` и `next`. `None`, если зазор слишком мал и нужен пересчёт.
fn slot(prev: Option<f64>, next: Option<f64>) -> Option<f64> {
    match (prev, next) {
        (None, None) => Some(STEP),
        (Some(p), None) => Some(p + STEP),
        (None, Some(n)) => Some(n - STEP),
        (Some(p), Some(n)) => {
            let half = (n - p) / 2.0;
            // после вставки по обе стороны останется по `half`: если это меньше порога, пересчитываем сейчас
            (half >= MIN_GAP).then_some(p + half)
        }
    }
}

/// Позиция для нового элемента в конце списка
pub fn after(last: Option<f64>) -> f64 {
    last.map_or(STEP, |p| p + STEP)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(positions: &[f64]) -> Vec<(u32, f64)> {
        positions.iter().enumerate().map(|(i, p)| (i as u32 + 1, *p)).collect()
    }

    #[test]
    fn first_item_in_an_empty_list_gets_the_step() {
        assert_eq!(place::<u32>(&[], 9, None), Ok(Placement::One(1024.0)));
    }

    #[test]
    fn appending_goes_one_step_after_the_last() {
        assert_eq!(place(&list(&[1024.0, 2048.0]), 9, None), Ok(Placement::One(3072.0)));
    }

    #[test]
    fn inserting_in_front_goes_one_step_before_the_first() {
        assert_eq!(place(&list(&[1024.0, 2048.0]), 9, Some(1)), Ok(Placement::One(0.0)));
        assert_eq!(
            place(&list(&[0.0, 5.0]), 9, Some(1)),
            Ok(Placement::One(-1024.0)),
            "позиции могут быть отрицательными"
        );
    }

    #[test]
    fn inserting_between_takes_the_middle() {
        assert_eq!(place(&list(&[1024.0, 2048.0, 3072.0]), 9, Some(2)), Ok(Placement::One(1536.0)));
        assert_eq!(place(&list(&[1024.0, 2048.0, 3072.0]), 9, Some(3)), Ok(Placement::One(2560.0)));
    }

    #[test]
    fn unknown_before_is_an_error() {
        assert_eq!(place(&list(&[1024.0]), 9, Some(42)), Err(BeforeNotFound));
    }

    #[test]
    fn tight_gap_triggers_a_rebalance_with_the_moved_item_in_place() {
        // зазор 1,5e-6: после вставки по 0,75e-6 с каждой стороны, меньше порога
        let siblings = list(&[1.0, 1.0 + 1.5e-6, 5.0]);
        let Placement::All(all) = place(&siblings, 9, Some(2)).unwrap() else {
            panic!("ожидался пересчёт")
        };
        assert_eq!(all, vec![(1, 1024.0), (9, 2048.0), (2, 3072.0), (3, 4096.0)]);
    }

    #[test]
    fn gap_just_above_the_threshold_is_still_used() {
        let siblings = list(&[1.0, 1.0 + 2.5e-6]);
        assert!(matches!(place(&siblings, 9, Some(2)), Ok(Placement::One(_))));
    }

    #[test]
    fn equal_positions_trigger_a_rebalance() {
        let siblings = list(&[7.0, 7.0]);
        assert!(matches!(place(&siblings, 9, Some(2)), Ok(Placement::All(_))));
    }

    #[test]
    fn rebalance_at_the_end_is_not_needed_because_appending_never_runs_out() {
        let siblings = list(&[1.0, 1.0 + 1e-9]);
        assert_eq!(place(&siblings, 9, None), Ok(Placement::One(1.0 + 1e-9 + 1024.0)));
    }

    #[test]
    fn repeated_insertion_between_neighbours_always_keeps_order() {
        // 200 раз подряд вставляем между первым и вторым: порядок не нарушается, пересчёт случается по пути
        let mut items: Vec<(u32, f64)> = list(&[1024.0, 2048.0]);
        let mut rebalances = 0;
        for id in 100..300u32 {
            let before = items[1].0;
            match place(&items, id, Some(before)).unwrap() {
                Placement::One(p) => items.insert(1, (id, p)),
                Placement::All(all) => {
                    rebalances += 1;
                    items = all;
                }
            }
            assert!(items.windows(2).all(|w| w[0].1 < w[1].1), "позиции строго возрастают: {items:?}");
        }
        assert!(rebalances >= 1, "за 200 вставок в одно место зазор должен был исчерпаться");
        assert_eq!(items.first().map(|i| i.0), Some(1), "первый остался первым");
        assert_eq!(items.last().map(|i| i.0), Some(2), "последний остался последним");
        assert_eq!(items.len(), 202);
    }

    #[test]
    fn after_appends_to_the_end() {
        assert_eq!(after(None), 1024.0);
        assert_eq!(after(Some(3072.5)), 4096.5);
    }
}
