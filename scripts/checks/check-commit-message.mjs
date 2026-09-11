import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMMIT_TYPES = [
  'feat',
  'fix',
  'refactor',
  'perf',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

export function checkCommitMessage(message) {
  const errors = [];
  const normalized = message.replace(/\r\n/g, '\n').trimEnd();
  const [subject, secondLine] = normalized.split('\n');
  const match =
    /^(?<type>[a-z]+)\((?<scope>[a-z][a-z0-9]*(?:-[a-z0-9]+)*)\)(?<breaking>!)?: (?<description>\S(?:.*\S)?)$/.exec(
      subject,
    );

  if (!match || !COMMIT_TYPES.includes(match.groups.type)) {
    errors.push(
      'Use type(scope): description with an allowed type and a lowercase kebab-case scope.',
    );
  } else {
    const { description, breaking } = match.groups;
    if (!/^[a-z]/.test(description)) {
      errors.push('Start the description with a lowercase English action verb.');
    }
    if (/[.!?]$/.test(description)) {
      errors.push('Do not end the subject with punctuation.');
    }
    if (breaking && !/^BREAKING CHANGE: \S.+/m.test(normalized)) {
      errors.push('Explain breaking changes in a BREAKING CHANGE: footer.');
    }
  }
  if ([...subject].length > 100) {
    errors.push('Keep the subject within 100 characters.');
  }
  if (secondLine !== undefined && secondLine !== '') {
    errors.push('Separate the subject and body with a blank line.');
  }

  // Names in attribution trailers are identities, not prose to translate.
  const prose = normalized
    .split('\n')
    .filter((line) => !/^(?:Co-authored-by|Signed-off-by): .+ <[^<>\s]+>$/i.test(line))
    .join('\n');
  if (/\p{Script=Han}/u.test(prose)) {
    errors.push('Write the subject and body in English; translate Chinese prose.');
  }
  if (
    [...normalized].some((character) => {
      const code = character.codePointAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127;
    })
  ) {
    errors.push('Do not include control characters in commit messages.');
  }

  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const filename = process.argv[2];
    if (!filename || process.argv.length !== 3) {
      throw new Error('Usage: node scripts/checks/check-commit-message.mjs <message-file>');
    }
    const errors = checkCommitMessage(readFileSync(filename, 'utf8'));
    if (errors.length > 0) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
