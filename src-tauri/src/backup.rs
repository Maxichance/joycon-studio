//! Sauvegardes de la puce SPI, stockées dans le dossier de données de l'application
//! (jamais dans le dépôt ni à côté de l'exécutable).

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::protocol::Side;

#[derive(Clone, Serialize, Deserialize)]
pub struct Region {
    pub addr: u32,
    pub hex: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DeviceRef {
    pub name: String,
    pub mac: String,
    pub firmware: String,
    pub serial: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Backup {
    pub id: String,
    pub created_ms: u64,
    pub side: Side,
    /// `colors` | `calibration` | `restore` | `reset`
    pub reason: String,
    pub device: DeviceRef,
    pub regions: Vec<Region>,
}

pub fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 || !s.is_ascii() {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

impl Backup {
    /// Octets sauvegardés pour `[addr, addr+len)`, si la sauvegarde les couvre.
    pub fn bytes_at(&self, addr: u32, len: usize) -> Option<Vec<u8>> {
        self.regions.iter().find_map(|r| {
            let data = from_hex(&r.hex)?;
            let start = addr.checked_sub(r.addr)? as usize;
            data.get(start..start + len).map(|s| s.to_vec())
        })
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() < 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn create(
    dir: &Path,
    side: Side,
    reason: &str,
    device: DeviceRef,
    regions: Vec<(u32, Vec<u8>)>,
) -> Result<Backup, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let created_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let id = format!("{created_ms}-{}", side.name());
    let backup = Backup {
        id: id.clone(),
        created_ms,
        side,
        reason: reason.to_string(),
        device,
        regions: regions
            .into_iter()
            .map(|(addr, b)| Region {
                addr,
                hex: to_hex(&b),
            })
            .collect(),
    };
    let json = serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{id}.json")), json).map_err(|e| e.to_string())?;
    Ok(backup)
}

pub fn list(dir: &Path) -> Vec<Backup> {
    let mut out: Vec<Backup> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| serde_json::from_str(&std::fs::read_to_string(e.path()).ok()?).ok())
        .collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.created_ms));
    out
}

pub fn load(dir: &Path, id: &str) -> Result<Backup, String> {
    if !valid_id(id) {
        return Err("invalid_backup".into());
    }
    let text = std::fs::read_to_string(dir.join(format!("{id}.json")))
        .map_err(|_| "invalid_backup".to_string())?;
    serde_json::from_str(&text).map_err(|_| "invalid_backup".to_string())
}

pub fn delete(dir: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("invalid_backup".into());
    }
    std::fs::remove_file(dir.join(format!("{id}.json"))).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        let b = vec![0u8, 1, 0xAB, 0xFF];
        assert_eq!(from_hex(&to_hex(&b)).unwrap(), b);
        assert!(from_hex("abc").is_none());
        assert!(from_hex("zz").is_none());
    }

    #[test]
    fn ids_reject_path_traversal() {
        assert!(!valid_id("../secret"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
        assert!(valid_id("1729431000000-left"));
    }

    #[test]
    fn bytes_at_slices_a_region() {
        let b = Backup {
            id: "x".into(),
            created_ms: 0,
            side: Side::Left,
            reason: "colors".into(),
            device: DeviceRef {
                name: String::new(),
                mac: String::new(),
                firmware: String::new(),
                serial: String::new(),
            },
            regions: vec![Region {
                addr: 0x6000,
                hex: to_hex(&(0u8..=15).collect::<Vec<_>>()),
            }],
        };
        assert_eq!(b.bytes_at(0x6004, 3).unwrap(), vec![4, 5, 6]);
        assert!(b.bytes_at(0x6010, 1).is_none());
        assert!(b.bytes_at(0x5FFF, 1).is_none());
    }

    #[test]
    fn create_list_load_delete() {
        let dir = std::env::temp_dir().join(format!("jcs-test-{}", std::process::id()));
        let dev = DeviceRef {
            name: "n".into(),
            mac: "m".into(),
            firmware: "f".into(),
            serial: "s".into(),
        };
        let b = create(
            &dir,
            Side::Right,
            "colors",
            dev,
            vec![(0x6050, vec![1, 2, 3])],
        )
        .unwrap();
        assert_eq!(list(&dir).len(), 1);
        assert_eq!(
            load(&dir, &b.id).unwrap().bytes_at(0x6050, 3).unwrap(),
            vec![1, 2, 3]
        );
        delete(&dir, &b.id).unwrap();
        assert!(list(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
