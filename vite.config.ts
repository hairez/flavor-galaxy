import { defineConfig } from 'vite';

// Project pages live at https://<user>.github.io/flavor-galaxy/
export default defineConfig({
  base: '/flavor-galaxy/',
  build: {
    target: 'es2022',
  },
});
