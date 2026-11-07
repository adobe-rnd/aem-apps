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
const GOOGLE_CODES = new Set([
  'af', 'am', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'ceb', 'co', 'cs', 'cy', 'da', 'de',
  'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'fi', 'fr', 'fy', 'ga', 'gd', 'gl', 'gu', 'ha',
  'haw', 'hi', 'hmn', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'iw', 'ja', 'jw', 'ka',
  'kk', 'km', 'kn', 'ko', 'ku', 'ky', 'la', 'lb', 'lo', 'lt', 'lv', 'mg', 'mi', 'mk', 'ml',
  'mn', 'mr', 'ms', 'mt', 'my', 'ne', 'nl', 'no', 'ny', 'or', 'pa', 'pl', 'ps', 'pt', 'pt-PT',
  'ro', 'ru', 'rw', 'sd', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'st', 'su', 'sv',
  'sw', 'ta', 'te', 'tg', 'th', 'tk', 'tl', 'tr', 'tt', 'ug', 'uk', 'ur', 'uz', 'vi', 'xh',
  'yi', 'yo', 'zh-CN', 'zh-TW', 'zu',
]);

const ALIASES = {
  he: 'iw', jv: 'jw', fil: 'tl', nb: 'no', nn: 'no',
};

const TRADITIONAL_REGIONS = ['TW', 'HK', 'MO'];

export function parseTag(tag) {
  if (typeof tag !== 'string' || !tag.trim()) return null;
  try {
    const locale = new Intl.Locale(tag.trim());
    if (!/^[a-z]{2,3}$/.test(locale.language)) return null;
    return {
      tag: locale.baseName,
      language: locale.language,
      script: locale.script,
      region: locale.region,
    };
  } catch {
    return null;
  }
}

function candidate({ language, script, region }) {
  if (language === 'zh') {
    const traditional = script === 'Hant' || (!script && TRADITIONAL_REGIONS.includes(region));
    return traditional ? 'zh-TW' : 'zh-CN';
  }
  if (language === 'pt' && region === 'PT') return 'pt-PT';
  return ALIASES[language] || language;
}

export function googleCode(tag) {
  const parsed = parseTag(tag);
  if (!parsed) return null;
  const code = candidate(parsed);
  return GOOGLE_CODES.has(code) ? code : null;
}
