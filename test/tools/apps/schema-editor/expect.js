/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
// A small chai-style `expect` over node:assert, covering the assertions the
// schema editor tests use, so they read like the da.live block tests they
// were ported from. Property assertions (`.to.be.true`, `.to.exist`) are left
// out on purpose: they trip `no-unused-expressions`; use `.to.equal()`.

import assert from 'node:assert/strict';

const isObject = (value) => value !== null && typeof value === 'object';

function includes(actual, expected, deep) {
  if (typeof actual === 'string') return actual.includes(expected);
  if (Array.isArray(actual) || actual instanceof Set) {
    return [...actual].some((item) => {
      if (!deep) return item === expected;
      try {
        assert.deepStrictEqual(item, expected);
        return true;
      } catch {
        return false;
      }
    });
  }
  if (isObject(actual) && isObject(expected)) {
    return Object.entries(expected).every(([key, value]) => {
      if (!deep) return actual[key] === value;
      try {
        assert.deepStrictEqual(actual[key], value);
        return true;
      } catch {
        return false;
      }
    });
  }
  return false;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

class Expectation {
  constructor(actual, message) {
    this.actual = actual;
    this.message = message;
    this.negated = false;
    this.isDeep = false;
  }

  get to() { return this; }

  get be() { return this; }

  get have() { return this; }

  get any() { return this; }

  get not() {
    this.negated = !this.negated;
    return this;
  }

  get deep() {
    this.isDeep = true;
    return this;
  }

  check(pass, message) {
    const prefix = this.message ? `${this.message}: ` : '';
    assert.ok(this.negated ? !pass : pass, `${prefix}${this.negated ? 'not: ' : ''}${message}`);
    return this;
  }

  equal(expected) {
    const { actual, message } = this;
    if (this.isDeep) {
      if (this.negated) assert.notDeepStrictEqual(actual, expected, message);
      else assert.deepStrictEqual(actual, expected, message);
      return this;
    }
    if (this.negated) assert.notStrictEqual(actual, expected, message);
    else assert.strictEqual(actual, expected, message);
    return this;
  }

  get include() {
    const assertion = (expected) => this.check(
      includes(this.actual, expected, this.isDeep),
      `expected ${JSON.stringify(this.actual)} to include ${JSON.stringify(expected)}`,
    );
    assertion.members = (expected) => this.check(
      expected.every((item) => includes(this.actual, item, this.isDeep)),
      `expected ${JSON.stringify(this.actual)} to include members ${JSON.stringify(expected)}`,
    );
    return assertion;
  }

  get contain() { return this.include; }

  members(expected) {
    return this.check(
      this.actual.length === expected.length
        && expected.every((item) => includes(this.actual, item, this.isDeep)),
      `expected ${JSON.stringify(this.actual)} to have members ${JSON.stringify(expected)}`,
    );
  }

  length(expected) {
    return this.check(
      this.actual?.length === expected,
      `expected length ${this.actual?.length} to be ${expected}`,
    );
  }

  a(type) {
    return this.check(typeOf(this.actual) === type, `expected ${typeOf(this.actual)} to be a ${type}`);
  }

  match(pattern) {
    return this.check(pattern.test(this.actual), `expected ${this.actual} to match ${pattern}`);
  }

  property(name) {
    return this.check(isObject(this.actual) && name in this.actual, `expected property ${name}`);
  }

  keys(...names) {
    const list = names.flat();
    return this.check(
      isObject(this.actual) && list.some((name) => name in this.actual),
      `expected any of the keys ${list.join(', ')}`,
    );
  }

  greaterThan(value) {
    return this.check(this.actual > value, `expected ${this.actual} to be greater than ${value}`);
  }

  throw(errorClass) {
    let thrown;
    try {
      this.actual();
    } catch (e) {
      thrown = e;
    }
    const pass = thrown !== undefined && (!errorClass || thrown instanceof errorClass);
    return this.check(pass, `expected the function to throw${errorClass ? ` ${errorClass.name}` : ''}`);
  }
}

// eslint-disable-next-line import/prefer-default-export
export const expect = (actual, message) => new Expectation(actual, message);
