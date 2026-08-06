import assert from 'node:assert/strict';
import test from 'node:test';

import { validateThemeNavbar } from '../src/themeNavbarValidator.js';

const slots = '<div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button>';

test('theme navbar validator reports parse5 errors with line and column', () => {
  assert.throws(
    () => validateThemeNavbar(`<nav>\n${slots}\n<!--></nav>`),
    (error) => error?.code === 'VALIDATION_FAILED'
      && /HTML parse error at line 3, column \d+: abrupt closing of empty comment/i.test(error.message)
  );
});

test('theme navbar validator preflights server templates before HTML parsing', () => {
  for (const navbar of [
    `<nav>{{ $dynamic }}${slots}</nav>`,
    `<nav><!-- <?php echo 'unsafe'; ?> -->${slots}</nav>`,
    `<nav><x-navigation>${slots}</x-navigation></nav>`,
    `<nav :class="$classes">${slots}</nav>`
  ]) {
    assert.throws(
      () => validateThemeNavbar(navbar),
      (error) => error?.code === 'VALIDATION_FAILED' && /static HTML.*line 1, column/i.test(error.message)
    );
  }
});

test('theme navbar validator accepts a strict browser-conforming AST', () => {
  assert.doesNotThrow(() => validateThemeNavbar(
    '<nav><!-- static --><header data-storefront-primary-navigation-slot></header><a href=/member/ data-storefront-member-auth-slot><svg viewBox="0 0 10 10"><path d="M0 0h1" /></svg>Member</a><button data-storefront-cart-slot>Cart</button><a href=/help/>Help</a></nav>'
  ));
});

test('theme navbar validator rejects document wrapper tags discarded by fragment parsing', () => {
  for (const wrapper of ['html', 'head', 'body']) {
    for (const navbar of [
      `<${wrapper}>${slots}</${wrapper}>`,
      `<${wrapper}>${slots}`
    ]) {
      assert.throws(
        () => validateThemeNavbar(navbar),
        (error) => error?.code === 'VALIDATION_FAILED'
          && new RegExp(`document wrapper <${wrapper}>`, 'i').test(error.message)
          && /line 1, column 1/i.test(error.message)
      );
    }
  }
});

test('theme navbar validator rejects wrapper start tags after an ordinary fragment element', () => {
  for (const wrapper of ['html', 'head', 'body']) {
    for (const navbar of [
      `<nav>${slots}</nav><${wrapper}></${wrapper}>`,
      `<nav>${slots}</nav><${wrapper}>`
    ]) {
      assert.throws(
        () => validateThemeNavbar(navbar),
        (error) => error?.code === 'VALIDATION_FAILED'
          && new RegExp(`document wrapper <${wrapper}>`, 'i').test(error.message)
          && /line 1, column \d+/i.test(error.message)
      );
    }
  }
});

test('theme navbar validator ignores wrapper-shaped text in comments and quoted attributes', () => {
  assert.doesNotThrow(() => validateThemeNavbar(
    `<nav title="literal <html> text" data-note='literal <body> text'><!-- literal <head> text -->${slots}</nav>`
  ));
});

test('theme navbar validator ignores wrapper-shaped text in style and title raw text', () => {
  assert.doesNotThrow(() => validateThemeNavbar(
    `<nav><style>.sample::before { content: "<html><body>"; }</style><title>literal <head> text</title>${slots}</nav>`
  ));
});

test('theme navbar validator rejects unavailable slots and unusable ordinary anchors', () => {
  assert.throws(
    () => validateThemeNavbar(`<nav hidden>${slots}</nav>`),
    /primary-navigation-slot.*available.*hidden/i
  );
  assert.throws(
    () => validateThemeNavbar(`<nav>${slots}<a>Help</a></nav>`),
    /every anchor.*exactly one.*href/i
  );
});

test('theme navbar validator requires required-slot elements in the HTML namespace', () => {
  const foreignNamespaceNavbars = [
    '<nav><div data-storefront-primary-navigation-slot></div><svg><a href="#member" data-storefront-member-auth-slot>Member</a><button data-storefront-cart-slot>Cart</button></svg></nav>',
    '<nav><div data-storefront-primary-navigation-slot></div><math><a href="#member" data-storefront-member-auth-slot>Member</a><button data-storefront-cart-slot>Cart</button></math></nav>',
    '<nav><svg><nav data-storefront-primary-navigation-slot></nav></svg><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>',
    '<nav><math><nav data-storefront-primary-navigation-slot></nav></math><button data-storefront-member-auth-slot>Member</button><button data-storefront-cart-slot>Cart</button></nav>'
  ];

  for (const navbar of foreignNamespaceNavbars) {
    assert.throws(
      () => validateThemeNavbar(navbar),
      (error) => error?.code === 'VALIDATION_FAILED' && /required.*HTML namespace|slot.*HTML namespace/i.test(error.message)
    );
  }
});

test('theme navbar validator handles many represented closing tags without pathological reconciliation', { timeout: 5000 }, () => {
  const siblings = Array.from({ length: 3000 }, (_, index) => `<span>Item ${index}</span>`).join('');
  assert.doesNotThrow(() => validateThemeNavbar(
    `<nav><div data-storefront-primary-navigation-slot></div><button data-storefront-member-auth-slot><svg viewBox="0 0 10 10"><path d="M0 0h1" /></svg>Member</button><button data-storefront-cart-slot>Cart</button>${siblings}</nav>`
  ));
});
