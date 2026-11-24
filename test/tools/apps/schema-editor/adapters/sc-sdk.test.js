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
import { describe, it } from 'node:test';
import { validateSchema } from '@adobe/da-sc-sdk';
import { expect } from '../expect.js';
import { COMPLETE_EXAMPLE } from '../core/model/fixtures.js';
import * as bundle from '../../../../../tools/deps/da-sc-sdk/dist/index.js';

describe('bundled SC SDK', () => {
  // A stale bundle (the package was bumped without `npm run build:da-sc-sdk`) fails here.
  it('ships a validator that agrees with the pinned @adobe/da-sc-sdk', async () => {
    const bundled = bundle.validateSchema;
    const invalid = { type: 'object', properties: { a: { type: 'null' } } };

    expect(bundled({ schema: COMPLETE_EXAMPLE })).to.deep.equal({ valid: true, schemaIssues: [] });
    expect(bundled({ schema: invalid }).valid).to.equal(false);
    [COMPLETE_EXAMPLE, invalid].forEach((schema) => {
      expect(bundled({ schema })).to.deep.equal(validateSchema({ schema }));
    });
  });
});
