// Vite resolves static-asset imports to their emitted URL.
declare module '*.png' {
  const src: string;
  export default src;
}
