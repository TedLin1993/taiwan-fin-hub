type IOSNavigator = Navigator & { standalone?: boolean };

export function isStandalonePwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as IOSNavigator).standalone === true
  );
}
