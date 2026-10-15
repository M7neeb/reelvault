// Ambient declarations for the CSS imports the Expo template ships with.
// Without these, `npx tsc --noEmit` reports missing modules (they're handled by
// Metro at bundle time, not by TypeScript).

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css';
