// Pas de console supplémentaire en release sous Windows. NE PAS RETIRER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    joycon_studio_lib::run();
}
