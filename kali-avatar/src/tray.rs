//! StatusNotifierItem tray (KDE, Hyprland/Sway bars, GNOME with the AppIndicator extension).

use crate::link::{Cmd, ToUi};
use ksni::menu::{MenuItem, StandardItem};

pub struct KaliTray {
    pub ui: async_channel::Sender<ToUi>,
    pub avatar_visible: bool,
}

impl KaliTray {
    fn item(&self, label: &str, cmd: fn() -> Cmd) -> MenuItem<Self> {
        StandardItem {
            label: label.into(),
            activate: Box::new(move |tray: &mut Self| {
                let _ = tray.ui.send_blocking(ToUi::Command(cmd()));
            }),
            ..Default::default()
        }
        .into()
    }
}

impl ksni::Tray for KaliTray {
    fn id(&self) -> String {
        "kali-avatar".into()
    }
    fn title(&self) -> String {
        "Kali Companion".into()
    }
    fn icon_name(&self) -> String {
        "kali-companion".into()
    }
    fn activate(&mut self, _x: i32, _y: i32) {
        let _ = self.ui.send_blocking(ToUi::Command(Cmd::OpenShell("chat")));
    }
    fn menu(&self) -> Vec<MenuItem<Self>> {
        vec![
            self.item("Abrir chat", || Cmd::OpenShell("chat")),
            self.item("Artefactos", || Cmd::OpenShell("artifacts")),
            self.item("Configuración", || Cmd::OpenShell("settings")),
            self.item(if self.avatar_visible { "Ocultar avatar" } else { "Mostrar avatar" }, || Cmd::ToggleAvatar),
            MenuItem::Separator,
            self.item("Salir", || Cmd::Quit),
        ]
    }
}
