import assert from 'node:assert/strict';
import test from 'node:test';
import extension from '../pi-extension/ask-user-question.ts';
import { visibleWidth, CURSOR_MARKER, stripTerminalSequences } from '@mariozechner/pi-tui';
const up = '\x1b[A', down = '\x1b[B', enter = '\r', escape = '\x1b';
const theme = { fg: (_color, text) => text, bold: text => text };

// Only replace the terminal/dialog boundary; use the real registered tool and Input.
async function ask(multiSelect, interact, options = [{ label: 'First', value: 'first' }], inspectUiOptions = () => {}) {
  let tool;
  extension({ registerTool(value) { tool = value; } });
  return tool.execute('test', { question: 'Pick one', options, multiSelect }, undefined, undefined, {
    hasUI: true,
    ui: { custom(factory, uiOptions) {
      inspectUiOptions(uiOptions);
      let result, finished = false;
      const component = factory({ requestRender() {} }, theme, {}, value => { result = value; finished = true; });
      component.focused = true;
      interact(component);
      assert.ok(finished, 'question should finish after submission or cancellation');
      return Promise.resolve(result);
    } },
  });
}

for (const multi of [false, true]) {
  test(`${multi ? 'multi' : 'single'} choice reports native waiting-for-question status`, async () => {
    let checked = false;
    await ask(multi, c => c.handleInput(escape), undefined, uiOptions => {
      assert.deepEqual(uiOptions?.blocked, { kind: 'question', message: 'Pick one' });
      checked = true;
    });
    assert.ok(checked, 'must request native blocked reporting when opening the dialog');
  });
  for (const [text, expected] of [['', 'Other'], ['   ', 'Other'], [' my custom answer ', 'my custom answer']]) {
    test(`${multi ? 'multi' : 'single'} inline Other submits ${JSON.stringify(text)}`, async () => {
      const result = await ask(multi, c => {
        assert.match(stripTerminalSequences(c.render(80).join('\n')), /Other\.\.\./);
        c.handleInput(down);
        for (const char of text) c.handleInput(char);
        assert.doesNotMatch(c.render(80).join('\n'), /Write your custom answer/);
        c.handleInput(enter);
        if (multi) { c.handleInput(down); c.handleInput(enter); }
      });
      assert.deepEqual(result.details.answers, [{ type: 'other', label: expected, value: expected }]);
    });
  }
  test(`${multi ? 'multi' : 'single'} preserves drafts and fits resized terminals`, async () => {
    const result = await ask(multi, c => {
      c.handleInput(down);
      for (const char of 'wide 界 answer') c.handleInput(char);
      c.handleInput(up); c.handleInput(down);
      assert.match(c.render(80).join('\n'), /wide 界 answer/);
      for (const width of [80, 12, 6, 1, 40]) {
        for (const line of c.render(width)) assert.ok(visibleWidth(line) <= width);
      }
      c.handleInput(enter);
      if (multi) { c.handleInput(down); c.handleInput(enter); }
    });
    assert.equal(result.details.answers[0].value, 'wide 界 answer');
  });
  test(`${multi ? 'multi' : 'single'} normal choices and cancellation remain intact`, async () => {
    const result = await ask(multi, c => {
      c.handleInput(enter);
      if (multi) { c.handleInput(down); c.handleInput(down); c.handleInput(enter); }
    }, [{ label: 'Other', value: 'regular-other' }]);
    assert.deepEqual(result.details.answers, [{ type: 'option', label: 'Other', value: 'regular-other', index: 1 }]);
    const cancelled = await ask(multi, c => { c.handleInput(down); c.handleInput(escape); });
    assert.equal(cancelled.details.status, 'cancelled');
  });
}

test('multi Other can be toggled off without losing regular choices', async () => {
  const result = await ask(true, c => {
    c.handleInput(enter); c.handleInput(down);
    c.handleInput(enter); c.handleInput('\x00');
    c.handleInput(down); c.handleInput(enter);
  });
  assert.deepEqual(result.details.answers, [{ type: 'option', label: 'First', value: 'first', index: 1 }]);
});

// Unconditionally delegating to Input.render must fail these tests: its fake
// cursor is emitted even when Input.focused is false.
const fakeCursorStart = '\x1b_pi:fc\x07';
function assertCursor(component, expected) {
  const output = component.render(80).join('\n');
  assert.equal(output.includes(fakeCursorStart), expected, 'fake cursor follows input focus');
  assert.equal(output.includes(CURSOR_MARKER), expected, 'hardware cursor marker follows input focus');
}

function otherRows(component, width) {
  const multi = component.render(80).some(line => stripTerminalSequences(line).includes('[ ] 1. First'));
  const lines = component.render(width);
  const start = lines.indexOf('') + 2; // First blank separates question from choices.
  const end = lines.findIndex((line, index) => index >= start && line === '');
  return lines.slice(start, end - (multi ? 1 : 0)); // Exclude the multi-choice Submit row.
}

for (const multi of [false, true]) {
  test(`${multi ? 'multi' : 'single'} wraps Other words onto aligned lines and submits original text`, async () => {
    const indent = multi ? 6 : 2;
    const result = await ask(multi, c => {
      c.handleInput(down);
      c.handleInput('alpha beta gamma delta');
      const rows = otherRows(c, indent + 12);
      assert.deepEqual(rows.map(row => stripTerminalSequences(row).slice(indent).trimEnd()), ['alpha beta', 'gamma delta']);
      assert.ok(rows.slice(1).every(row => row.startsWith(' '.repeat(indent))));
      assert.equal(rows.filter(row => row.includes(CURSOR_MARKER)).length, 1);
      c.focused = false;
      const inactive = otherRows(c, indent + 12);
      assert.deepEqual(inactive.map(row => stripTerminalSequences(row).slice(indent).trimEnd()), ['alpha beta', 'gamma delta']);
      assert.ok(inactive.every(row => !row.includes(fakeCursorStart) && !row.includes(CURSOR_MARKER)));
      assert.equal(otherRows(c, 80).length, 1, 'resize reflows the original draft');
      c.focused = true;
      c.handleInput(enter);
      if (multi) { c.handleInput(down); c.handleInput(enter); }
    });
    assert.equal(result.details.answers[0].value, 'alpha beta gamma delta');
  });

  test(`${multi ? 'multi' : 'single'} wraps long words and keeps boundary cursor with its cell`, async () => {
    const indent = multi ? 6 : 2;
    await ask(multi, c => {
      c.handleInput(down);
      c.handleInput('abcdefghijkl');
      const rows = otherRows(c, indent + 6);
      assert.deepEqual(rows.map(row => stripTerminalSequences(row).slice(indent)), ['abcdef', 'ghijkl', ' ']);
      assert.ok(rows[2].includes(CURSOR_MARKER + fakeCursorStart + ' '));
      assert.ok(rows.slice(0, 2).every(row => !row.includes(CURSOR_MARKER) && !row.includes(fakeCursorStart)));
      c.handleInput('\x1b[D');
      const editedRows = otherRows(c, indent + 6);
      assert.ok(editedRows[1].includes(CURSOR_MARKER + fakeCursorStart + 'l'));
      c.handleInput('!');
      c.handleInput(enter);
      if (multi) { c.handleInput(down); c.handleInput(enter); }
    });
  });

  test(`${multi ? 'multi' : 'single'} wraps Unicode and preserves whitespace and edit position`, async () => {
    const indent = multi ? 6 : 2;
    const result = await ask(multi, c => {
      c.handleInput(down);
      c.handleInput('界界 e\u0301   abcdefghijkl');
      for (const width of [indent + 6, 1, 6, 12, 40]) {
        for (const line of c.render(width)) assert.ok(visibleWidth(line) <= width);
      }
      const rows = otherRows(c, indent + 6);
      assert.ok(rows.length > 2);
      assert.equal(rows.map(row => stripTerminalSequences(row).slice(indent)).join(''), '界界 e\u0301   abcdefghijkl ');
      c.handleInput('\x1b[D');
      c.handleInput(up);
      c.render(indent + 6);
      c.handleInput(down);
      c.handleInput('!');
      c.handleInput(enter);
      if (multi) { c.handleInput(down); c.handleInput(enter); }
    });
    assert.equal(result.details.answers[0].value, '界界 e\u0301   abcdefghijk!l');
  });

  test(`${multi ? 'multi' : 'single'} retains one cursor when editing merges Unicode graphemes`, async () => {
    const indent = multi ? 6 : 2;
    const result = await ask(multi, c => {
      c.handleInput(down);
      c.handleInput('👩👩');
      c.handleInput('\x1b[D');
      c.handleInput('\u200d');
      const rows = otherRows(c, indent + 6);
      assert.equal(rows.filter(row => row.includes(CURSOR_MARKER)).length, 1);
      assert.equal(rows.filter(row => row.includes(fakeCursorStart)).length, 1);
      assert.equal(rows.map(row => stripTerminalSequences(row).slice(indent)).join(''), '👩‍👩');
      c.focused = false;
      assertCursor(c, false);
      c.focused = true;
      assertCursor(c, true);
      c.handleInput('!'); // Displaying the merged cluster must not move the editing position.
      c.handleInput(enter);
      if (multi) { c.handleInput(down); c.handleInput(enter); }
    });
    assert.equal(result.details.answers[0].value, '👩‍!👩');
  });

  test(`${multi ? 'multi' : 'single'} empty Other cursor follows navigation and dialog focus`, async () => {
    await ask(multi, c => {
      assertCursor(c, false);
      assert.match(stripTerminalSequences(c.render(80).join('\n')), /Other\.\.\./);
      c.handleInput(down);
      assertCursor(c, true);
      c.focused = false;
      assertCursor(c, false);
      c.focused = true;
      assertCursor(c, true);
      c.handleInput(up);
      assertCursor(c, false);
      c.handleInput(escape);
    });
  });

  test(`${multi ? 'multi' : 'single'} populated Other hides its cursor without losing draft or edit position`, async () => {
    const result = await ask(multi, c => {
      c.handleInput(down);
      c.handleInput('wide 界 answer');
      c.handleInput('\x1b[D'); // Leave the editing position before the final r.
      assertCursor(c, true);
      c.handleInput(up);
      assertCursor(c, false);
      assert.match(stripTerminalSequences(c.render(80).join('\n')), /wide 界 answer/);
      for (const width of [80, 12, 6, 1, 40]) {
        for (const line of c.render(width)) assert.ok(visibleWidth(line) <= width);
      }
      c.handleInput(down);
      assertCursor(c, true);
      c.focused = false;
      assertCursor(c, false);
      c.focused = true;
      assertCursor(c, true);
      c.handleInput('!');
      c.handleInput(enter);
      if (multi) { c.handleInput(down); c.handleInput(enter); }
    });
    assert.equal(result.details.answers[0].value, 'wide 界 answe!r');
  });
}
