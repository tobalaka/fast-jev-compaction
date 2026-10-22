import type { JevAnswer, JevQuestions, JevResponse, JevState } from './types.js';

export const SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const DEFAULT_MODEL = 'jev-latest';

export interface JevRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** The HTTP request for one Jev call, for any fetch-like transport. */
export function buildJevRequest(
  params: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
  },
  state: JevState,
  questions: JevQuestions,
): JevRequest {
  return {
    url: params.baseUrl ?? SYSTEM_ONE_URL,
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model ?? DEFAULT_MODEL,
      state,
      questions,
    }),
  };
}

/** Validates a Jev response body; throws on anything but an `answers` object. */
export function parseJevResponse(
  status: number,
  ok: boolean,
  text: string,
): JevResponse {
  if (!ok) {
    throw new Error(`Jev request failed (${status}): ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Jev returned malformed JSON');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('answers' in parsed) ||
    parsed.answers === null ||
    typeof parsed.answers !== 'object'
  ) {
    throw new Error('Jev response is missing answers');
  }
  return parsed as JevResponse;
}

/** The `noul` probability of one answer; throws when it is not there. */
export function noulAnswer(
  answers: Record<string, JevAnswer>,
  name: string,
): number {
  const answer = answers[name];
  if (
    !answer ||
    !('noul' in answer) ||
    typeof answer.noul !== 'number' ||
    !Number.isFinite(answer.noul)
  ) {
    throw new Error(`Invalid Jev answer for ${name}`);
  }
  return answer.noul;
}

export const DEFAULT_SUBAGENT_MODEL = 'claude-haiku-5-5';

/** The task for a subagent standing in for Jev: score every question from 0 to 1. */
export function buildSubagentPrompt(state: JevState, questions: JevQuestions): string {
  const items = Object.entries(questions).map(([name, q]) => `- ${name}: ${q.instructions}`);
  return [
    'You decide which parts of a coding-agent conversation must stay in its context.',
    'Do not use any tools. Read the conversation state below, then give each statement a probability',
    'between 0 and 1 that it is true (1 = certainly true, 0 = certainly false).',
    'Tool results in the state are omitted on purpose; judge from the calls, their inputs and the surrounding text.',
    '',
    '<state>',
    typeof state === 'string' ? state : JSON.stringify(state),
    '</state>',
    '',
    'Statements:',
    ...items,
    '',
    'Reply with one JSON object and nothing else, mapping every statement name to its probability,',
    'for example {"call_t1": 0.9, "result_t1": 0.2}.',
  ].join('\n');
}

/** Turns a subagent's reply into a Jev-shaped response; throws unless every question got a number in [0, 1]. */
export function parseSubagentResponse(text: string, questions: JevQuestions): JevResponse {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Subagent returned malformed JSON');
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Subagent response is missing answers');
  }
  const answers: Record<string, JevAnswer> = {};
  for (const name of Object.keys(questions)) {
    const value = (parsed as Record<string, unknown>)[name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`Invalid subagent answer for ${name}`);
    }
    answers[name] = { type: 'noul', noul: value };
  }
  return { answers };
}
