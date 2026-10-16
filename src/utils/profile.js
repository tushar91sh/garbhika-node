import { assert, clean } from './validation.js'
export const stages = [
  'Planning pregnancy',
  'Pregnant',
  'Postpartum',
  'Exploring support',
]
export const services = [
  'Garbh Sanskar',
  'Pregnancy yoga',
  'Pregnancy nutrition',
  'Psychological support',
  'Mental wellness',
  'Pregnancy guidance',
  'Community support',
  'Help me choose',
]
export const languages = ['Hindi', 'English', 'Both']
export function validateProfile(body = {}) {
  const stage = clean(body.stage),
    language = clean(body.language),
    context = clean(body.context)
  assert(stages.includes(stage), 'Choose your current journey stage.')
  assert(languages.includes(language), 'Choose Hindi, English or both.')
  assert(
    Array.isArray(body.services) &&
      body.services.length > 0 &&
      body.services.length <= services.length &&
      body.services.every((x) => services.includes(x)),
    'Choose at least one valid service.',
  )
  assert(
    context.length <= 1000,
    'Additional context must be 1,000 characters or fewer.',
  )
  const dueDate = stage === 'Pregnant' ? clean(body.dueDate) : ''
  if (dueDate) {
    const d = new Date(dueDate + 'T00:00:00Z')
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(dueDate) &&
        !Number.isNaN(d.getTime()) &&
        d.toISOString().slice(0, 10) === dueDate,
      'Enter a valid due date.',
    )
    assert(
      Math.abs(d.getTime() - Date.now()) <= 300 * 86400000,
      'Please check your expected due date.',
    )
  }
  return {
    stage,
    language,
    context,
    dueDate,
    services: [...new Set(body.services)],
    completed: true,
  }
}
