// Compile the message files (as the Vite build does), so svelte-check sees the current messages.
import { compile } from '@inlang/paraglide-js';
import { paraglideOptions } from '../paraglide.config.js';

await compile(paraglideOptions);
