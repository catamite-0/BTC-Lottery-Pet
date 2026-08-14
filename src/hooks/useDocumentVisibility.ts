import { useEffect, useState } from "react";

function documentIsVisible() {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function syncWindowHiddenClass(visible: boolean) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.toggle("pet-window-hidden", !visible);
}

export function useDocumentVisibility() {
  const [visible, setVisible] = useState(documentIsVisible);

  useEffect(() => {
    const sync = () => {
      const next = documentIsVisible();
      syncWindowHiddenClass(next);
      setVisible(next);
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      document.documentElement.classList.remove("pet-window-hidden");
    };
  }, []);

  return visible;
}
