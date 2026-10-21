// Next's `server-only` guard throws outside a React server build. Under Vitest there is no client
// boundary to guard, so the preset points `server-only` here: an empty module. The real guard
// still holds where Next builds the app.
export {};
