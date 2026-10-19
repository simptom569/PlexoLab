//! Помощники для JSON: даты `ГГГГ-ММ-ДД` и поля PATCH, где важно отличить «не передано» от `null`.

use serde::{Deserialize, Deserializer};

/// Для полей `Option<Option<T>>` в запросах PATCH: поле нет → `None` (не трогать), `null` → `Some(None)` (очистить),
/// значение → `Some(Some(v))`. Использовать вместе с `#[serde(default)]`.
pub fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// Дата `2026-10-22`
pub mod iso_date {
    use serde::{Deserialize, Deserializer, Serializer, de::Error as _, ser::Error as _};
    use time::{Date, format_description::well_known::Iso8601};

    pub fn serialize<S: Serializer>(date: &Date, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&date.format(&Iso8601::DATE).map_err(S::Error::custom)?)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Date, D::Error> {
        parse(&String::deserialize(deserializer)?).map_err(D::Error::custom)
    }

    fn parse(s: &str) -> Result<Date, String> {
        Date::parse(s, &Iso8601::DATE).map_err(|_| format!("дата «{s}» должна быть вида 2026-10-22"))
    }

    /// `Option<Date>`: пусто в JSON — `null`
    pub mod option {
        use serde::{Deserialize, Deserializer, Serializer, de::Error as _};
        use time::Date;

        pub fn serialize<S: Serializer>(date: &Option<Date>, serializer: S) -> Result<S::Ok, S::Error> {
            match date {
                Some(d) => super::serialize(d, serializer),
                None => serializer.serialize_none(),
            }
        }

        pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Date>, D::Error> {
            Option::<String>::deserialize(deserializer)?.map(|s| super::parse(&s).map_err(D::Error::custom)).transpose()
        }
    }

    /// Для PATCH: `Option<Option<Date>>` (см. `present`)
    pub mod patch {
        use serde::Deserializer;
        use time::Date;

        pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Option<Date>>, D::Error> {
            super::option::deserialize(deserializer).map(Some)
        }
    }
}

#[cfg(test)]
mod tests {
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use time::{Date, Month};
    use uuid::Uuid;

    use super::*;

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Row {
        #[serde(with = "iso_date")]
        day: Date,
        #[serde(with = "iso_date::option")]
        maybe: Option<Date>,
    }

    #[derive(Debug, Deserialize, PartialEq)]
    struct Patch {
        #[serde(default, deserialize_with = "present")]
        assignee: Option<Option<Uuid>>,
        #[serde(default, deserialize_with = "iso_date::patch::deserialize")]
        due: Option<Option<Date>>,
    }

    fn d(y: i32, m: Month, day: u8) -> Date {
        Date::from_calendar_date(y, m, day).unwrap()
    }

    #[test]
    fn dates_roundtrip_as_plain_strings() {
        let row = Row { day: d(2026, Month::October, 22), maybe: None };
        let json = serde_json::to_value(&row).unwrap();
        assert_eq!(json, json!({ "day": "2026-10-22", "maybe": null }));
        assert_eq!(serde_json::from_value::<Row>(json).unwrap(), row);
        let with = serde_json::from_value::<Row>(json!({ "day": "2026-01-05", "maybe": "2026-12-31" })).unwrap();
        assert_eq!(with.maybe, Some(d(2026, Month::December, 31)));
    }

    #[test]
    fn bad_dates_are_rejected() {
        for bad in ["22.10.2026", "2026-13-01", "2026-02-30", "", "tomorrow"] {
            assert!(serde_json::from_value::<Row>(json!({ "day": bad, "maybe": null })).is_err(), "{bad}");
        }
    }

    #[test]
    fn patch_distinguishes_missing_null_and_value() {
        let id = Uuid::new_v4();
        let missing: Patch = serde_json::from_value(json!({})).unwrap();
        assert_eq!(missing, Patch { assignee: None, due: None });
        let null: Patch = serde_json::from_value(json!({ "assignee": null, "due": null })).unwrap();
        assert_eq!(null, Patch { assignee: Some(None), due: Some(None) });
        let value: Patch = serde_json::from_value(json!({ "assignee": id, "due": "2026-10-22" })).unwrap();
        assert_eq!(value, Patch { assignee: Some(Some(id)), due: Some(Some(d(2026, Month::October, 22))) });
        assert!(serde_json::from_value::<Patch>(json!({ "due": "nope" })).is_err());
    }
}
