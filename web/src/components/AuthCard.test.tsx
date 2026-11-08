import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextField } from './AuthCard';

describe('TextField', () => {
  it('keeps the show-password toggle out of the tab order', () => {
    const html = renderToStaticMarkup(
      <TextField label="App password" type="password" value="" onChange={() => {}} />,
    );
    expect(html).toMatch(/<button[^>]*tabindex="-1"[^>]*aria-label="Show password"/);
  });
});
