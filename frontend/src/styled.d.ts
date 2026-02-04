// src/styled.d.ts
import 'styled-components';

declare module 'styled-components' {
  export interface DefaultTheme {
    colors: {
      bg: string;
      text: string;
      accent: string;
      card: string;
      inner: string;
      border: string;
      white: string;
      muted: string;
    };
    radius: {
      sm: string;
      md: string;
      lg: string;
      btn: string;
    };
    shadow: {
      soft: string;
    };
    font: {
      base: string;
    };
  }
}
