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

export function parseLanguage(code) {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  let locale;
  try {
    locale = new Intl.Locale(trimmed);
  } catch {
    return null;
  }
  if (!/^[a-z]{2,3}$/.test(locale.language)) return null;
  if (locale.baseName !== locale.toString()) return null;
  return {
    tag: locale.toString(),
    language: locale.language,
    script: locale.script,
    region: locale.region,
  };
}

const baseOf = ({ language, script }) => (script ? `${language}-${script}` : language);

export function isSameBaseLanguage(first, second) {
  const firstParsed = parseLanguage(first);
  const secondParsed = parseLanguage(second);
  if (!firstParsed || !secondParsed) return false;
  return baseOf(firstParsed) === baseOf(secondParsed);
}

export function canTranslate(source, target) {
  const sourceParsed = parseLanguage(source);
  const targetParsed = parseLanguage(target);
  if (!sourceParsed || !targetParsed) return false;
  return sourceParsed.tag !== targetParsed.tag;
}

export function defaultRefreshAction(source, target) {
  return isSameBaseLanguage(source, target) ? 'rollout' : 'translate';
}

export function languageLabel(code, displayLocale = 'en') {
  const parsed = parseLanguage(code);
  if (!parsed) return code;
  return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(parsed.tag);
}
