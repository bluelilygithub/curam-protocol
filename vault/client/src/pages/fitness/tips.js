/**
 * Plain-language explanations shown in InfoTip popovers. One place, so the wording stays consistent and is easy to evolve
 * as stages ship. Keep each to what a person wants to know: what it is, why it exists, and what it does not mean.
 */

export const TIPS = {
  weekGuide: {
    title: 'How the week works',
    sections: [
      { title: 'Moving a session', body: 'Sessions are suggestions, not appointments. Drag one to another day or time, or open a day and press Move. The week keeps the same targets wherever it lands.' },
      { title: 'Does morning or afternoon matter?', body: 'Mostly no. Pick the time you will actually keep. Leave about 48 hours between strength sessions so your muscles recover (you get a gentle note, never a block), and in hot weather do outdoor sessions in the early morning or evening.' },
      { title: 'Rest days', body: 'Two planned rest days plus one flexible day to use whenever you need it. Taking a day off moves its session to a free slot later in the week if there is room, otherwise it is let go. Nothing is piled onto other days.' },
      { title: 'Training blocks', body: 'Weeks come in blocks of five: four building weeks, then a lighter one on purpose so your body can absorb the work.' },
      { title: 'A different version', body: 'Same targets, different exercises. Only possible before you have logged anything this week.' },
    ],
  },
  move: {
    title: 'Why move a session?',
    body: 'Sessions are suggestions, not appointments. Move one to a day and time that fits your life: drag it, or press Move on the card. The week keeps the same targets wherever it lands.',
  },
  timeOfDay: {
    title: 'Does morning or afternoon matter?',
    body: 'Mostly no. Morning, midday and evening are only a planning suggestion; the exercise is the same whenever you do it, so pick the time you will actually keep. Two things are worth knowing: leave about 48 hours between strength sessions so your muscles can recover (you get a gentle note, never a block), and in hot weather outdoor sessions are kinder in the early morning or evening.',
  },
  rest: {
    title: 'Taking a rest day',
    body: 'Rest is part of training: it is when your body adapts. If you take a day off, that day\'s session moves to a free slot later in the week when there is room, otherwise it is simply let go. Nothing is piled onto other days, and it is not counted against you.',
  },
  restBudget: {
    title: 'The flexible rest day',
    body: 'Each week has two planned rest days plus one flexible day you can use whenever you need it. Using it is normal. Going past it is fine too; the week just has a little less work in it.',
  },
  block: {
    title: 'Training blocks',
    body: 'Weeks come in blocks of five: four building weeks, then a lighter week on purpose so your body can absorb the work. Within a block the targets stay steady while the exercises change.',
  },
  regenerate: {
    title: 'A different version',
    body: 'Same targets, different exercises. You can only do this before you have done anything this week.',
  },
  warmup: {
    title: 'Warm-up and cool-down',
    body: 'About five minutes each. The warm-up gets your joints moving first; the cool-down settles you afterwards. They are not counted toward your weekly targets.',
  },
  hide: {
    title: 'Hiding an exercise',
    body: 'If an exercise does not suit you, for example a sore knee, hide it. Your program skips it from the next week it makes. You can show it again any time.',
  },
  mineOnly: {
    title: 'Only what I can do',
    body: 'Hides exercises that need equipment you did not list in your Profile. Untick it to see everything.',
  },
  ladder: {
    title: 'Easier and harder versions',
    body: 'Each movement is a ladder of versions. Your program uses the step that fits your ratings and moves along as you progress.',
  },
  effort: {
    title: 'How hard should it feel?',
    body: 'Use the talk test while you move, and the 1 to 10 scale afterwards. Around 4 to 5 means breathing is up but you can still talk in short sentences. The two scales line up (see the table).',
  },
  dashActivity: {
    title: 'Planned and done',
    body: 'Each pair of bars is one week: the light bar is the aerobic time planned, the dark bar is what you logged. Partly done counts as half, rest is never counted against you, and the shaded band is the WHO guideline of 150 to 300 minutes. A week with little logged looks low because nothing was recorded, not because nothing happened.',
  },
  dashBalance: {
    title: 'Balance across the four kinds of work',
    body: 'Over your last few logged weeks: how much cardio, strength, balance and mobility you did against what the plan asked. A bar that is not full is a prompt to look at next week, not a mark against you. Weeks with little logged are left out.',
  },
  dashCalendar: {
    title: 'Your weeks at a glance',
    body: 'One square per day. Green is done, amber is some done, blue is rest, violet is something extra, and grey is planned or not logged. There is no streak to protect: rest is a good thing and a quiet day does not break anything.',
  },
  dashProjection: {
    title: 'Where your recent weeks are heading',
    body: 'The dotted line extends the trend of your last four to eight logged weeks (lighter weeks are left out). A flat or falling run is shown as holding steady, the climb is held to the rule the plan itself follows of about 10% a week, and it never goes beyond the plan: it can fall short of it or reach it. It is a rough guide only, and needs at least four logged weeks.',
  },
  reminders: {
    title: 'How reminders work',
    body: 'Three optional emails, all off until you switch them on: your plan in the morning (only on days with a session), one gentle evening note if today is still open, and a re-rate nudge when it is due. Times follow your time zone in Settings. Nothing is sent on a rest day, you can pause for a week, and after three weeks with nothing logged they stop by themselves. Every email has a link to stop it.',
  },
  fitnessTasks: {
    title: 'How sessions and Tasks stay together',
    body: 'Each upcoming session becomes a task in your Tasks list (category Fitness). Moving the session moves the task, and logging it completes the task. Rest days and sessions you did not do have no task, and a session whose day has passed quietly drops out, so nothing turns red. If you delete a task it stays deleted. You can switch this off here at any time.',
  },
  dashEffort: {
    title: 'How hard weeks have felt',
    body: 'The average of the 1 to 10 effort scores you recorded each week (sessions done in some way, plus extras). It is your own feeling, not a test. The plan uses it: three comfortable weeks in a row nudge the next week up, and two hard weeks ease it off.',
  },
  dashLoads: {
    title: 'The weight you lifted',
    body: 'The weight logged for one exercise each time you did it. Pick an exercise from the list. Only exercises where you have logged a weight appear.',
  },
  dashWeight: {
    title: 'Your weight',
    body: 'Only if you add weigh-ins, and only as a number: there is no target here and no colour for up or down. Weight moves around from day to day, so look at the direction over weeks.',
  },
  ratings: {
    title: 'What your ratings do',
    body: 'Your own 1 to 5 ratings decide which versions of each exercise you are offered in the weeks to come, and they are kept so you can see how you have changed. They are not checked by anyone. Your five-year goal stays as it is until you revisit it.',
  },
};
