import { describe, expect, it } from 'vitest';
import { hasText, sanitizeNewsHtml } from './html-sanitizer';

describe('news body sanitiser (SPEC §4.6 allowlist)', () => {
  it('keeps the allowlisted structure', () => {
    const html =
      '<h2>Title</h2><h3>Sub</h3><p><strong>b</strong> <em>i</em><br></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><pre><code>x</code></pre>';
    expect(sanitizeNewsHtml(html)).toBe(
      '<h2>Title</h2><h3>Sub</h3><p><strong>b</strong> <em>i</em><br /></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><pre><code>x</code></pre>',
    );
  });

  it('removes scripts, handlers, images, iframes and styles', () => {
    const out = sanitizeNewsHtml(
      '<p onclick="x()" style="color:red">Hi<script>alert(1)</script><img src=x onerror=alert(1)></p><iframe src="https://e.example.com"></iframe><style>p{}</style>',
    );
    expect(out).toBe('<p>Hi</p>');
  });

  it('allows https and mailto links only, with rel and target', () => {
    expect(sanitizeNewsHtml('<a href="https://wiki.example.com" class="x">w</a>')).toBe(
      '<a href="https://wiki.example.com" rel="noopener noreferrer" target="_blank">w</a>',
    );
    expect(sanitizeNewsHtml('<a href="mailto:people-ops@example.com">m</a>')).toContain('href="mailto:');
    for (const bad of [
      'javascript:alert(1)',
      '&#x6A;avascript:alert(1)',
      'java\tscript:alert(1)',
      'http://plain.example.com',
      '//evil.example.com',
      'data:text/html,x',
      '/api/v1/admin/users',
      '#top',
      'relative-page',
    ]) {
      expect(sanitizeNewsHtml(`<p><a href="${bad}">text</a> and <a href="https://ok.example.com">ok</a></p>`)).toBe(
        '<p>text and <a href="https://ok.example.com" rel="noopener noreferrer" target="_blank">ok</a></p>',
      );
    }
  });

  it('maps editor output onto the allowlist', () => {
    expect(sanitizeNewsHtml('<h1>A</h1><b>B</b><i>I</i><h4>D</h4>')).toBe(
      '<h2>A</h2><strong>B</strong><em>I</em><h3>D</h3>',
    );
  });

  it('detects empty bodies', () => {
    expect(hasText('<p><br></p>')).toBe(false);
    expect(hasText('<p> x </p>')).toBe(true);
  });
});
