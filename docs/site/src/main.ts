import './app.css';
import 'highlight.js/styles/github.css';
import App from './App.svelte';
import { mount } from 'svelte';

mount(App, {
  target: document.getElementById('app')!,
});
