// Миграции вшиваются в бинарник макросом sqlx::migrate!, при их изменении крейт нужно пересобрать.
fn main() {
    println!("cargo:rerun-if-changed=../../migrations");
}
