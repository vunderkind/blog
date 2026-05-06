# Tufte CSS Authoring Snippets

Copy-paste these into Ghost's HTML card (type `/html` in the editor) when
writing a post. They map directly to features defined in
`assets/built/tufte.css` and the inline shell.

> **Important rule for sidenotes / marginnotes**: the markup must live
> *inside* the `<p>` it annotates. The float pulls the note into the
> margin alongside that paragraph; without a `<p>` wrapper there is
> nothing for it to float against and the note disappears off-screen.
> So when adding a sidenote, the entire paragraph plus the sidenote
> goes into a **single** HTML card — not two cards.

## 1. Sidenote (numbered, auto-incremented)

```html
<p>This is a normal sentence that mentions an aside<label for="sn-1" class="margin-toggle sidenote-number"></label><input type="checkbox" id="sn-1" class="margin-toggle"/><span class="sidenote">The aside itself, set in the margin in smaller type.</span> and then continues to the end of the paragraph.</p>
```

Bump the `id` (`sn-2`, `sn-3`, ...) per note so each toggle is unique on
mobile.

## 2. Marginnote (no number, ⊕ symbol on mobile)

```html
<p>A claim that benefits from a side observation<label for="mn-1" class="margin-toggle">&#8853;</label><input type="checkbox" id="mn-1" class="margin-toggle"/><span class="marginnote">Side observation, no number.</span>, and the rest of the sentence after.</p>
```

## 3. Newthought (small-caps paragraph opener)

```html
<p><span class="newthought">In the beginning</span> there was…</p>
```

## 4. Epigraph (chapter-opener quote)

```html
<div class="epigraph">
  <blockquote>
    <p>The cowards never started and the weak died on the way.</p>
    <footer>Author Name, <cite>Source Title</cite></footer>
  </blockquote>
</div>
```

## 5. Full-width figure (90% column instead of 55%)

```html
<figure class="fullwidth">
  <img src="..." alt="...">
  <figcaption>Caption text.</figcaption>
</figure>
```

Ghost's "Wide" image card (`kg-width-wide`) is also auto-styled to
fullwidth — no extra markup needed when uploading via the editor.

## 6. Numeral (old-style figures inline)

```html
<p>In <span class="numeral">1969</span>, …</p>
```

## 7. Sans-serif utility

```html
<span class="sans">Sans-serif text with letter-spacing</span>
```

## 8. Danger utility

```html
<span class="danger">Critical warning</span>
```

## 9. Responsive 16:9 iframe / video

```html
<div class="iframe-wrapper">
  <iframe src="https://www.youtube.com/embed/..." allowfullscreen></iframe>
</div>
```

Ghost's YouTube embed card (`kg-embed-card`) is auto-styled for 16:9, so
this snippet is only needed for non-Ghost embeds.

## 10. Full-width pre / code block

```html
<pre class="fullwidth"><code>... long code ...</code></pre>
```

## 11. Table wrapper (horizontal-scroll on narrow screens)

```html
<div class="table-wrapper">
  <table>
    <thead><tr><th>Header</th><th>Header</th></tr></thead>
    <tbody>
      <tr><td>Cell</td><td>Cell</td></tr>
    </tbody>
  </table>
</div>
```
