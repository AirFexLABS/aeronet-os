import { useEffect, useState } from "react";
import themeData from "../theme/theme.json";

interface Theme {
  brand: { name: string; logo_path: string; favicon_path: string };
  colors: Record<string, string>;
  fonts: Record<string, string>;
}

const theme = themeData as Theme;

export function useTheme(): Theme {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    Object.entries(theme.colors).forEach(([k, v]) =>
      document.documentElement.style.setProperty(k, v)
    );
    Object.entries(theme.fonts).forEach(([k, v]) =>
      document.documentElement.style.setProperty(k, v)
    );
    document.title = theme.brand.name;
    const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (favicon) favicon.href = theme.brand.favicon_path;
    forceUpdate((n) => n + 1);
  }, []);

  return theme;
}
