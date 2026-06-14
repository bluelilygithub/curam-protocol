'use strict';

const { getModelsForUser } = require('./modelResolver');
const { callModel } = require('./callModel');

function safeJsonParse(text) {
  if (!text) return null;
  const trimmed = String(text).trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}

function normaliseInsight(raw, fallback) {
  const insight = raw && typeof raw === 'object' ? raw : {};
  const sections = Array.isArray(insight.sections) ? insight.sections : fallback.sections;
  return {
    summary: String(insight.summary || fallback.summary || '').slice(0, 1800),
    sections: sections
      .filter((section) => section && (section.title || section.body))
      .slice(0, 9)
      .map((section) => ({
        title: String(section.title || 'Insight').slice(0, 80),
        body: String(section.body || '').slice(0, 2600),
      })),
    questions: Array.isArray(insight.questions)
      ? insight.questions.map((q) => String(q || '').trim()).filter(Boolean).slice(0, 6)
      : fallback.questions,
    caveat: String(insight.caveat || fallback.caveat || '').slice(0, 800),
    generatedByModel: !!raw,
    formatVersion: 2,
  };
}

function fallbackInsight({ title, analysis, scoreLines = [] }) {
  const patterns = scoreLines.slice(0, 6).join('; ');
  return {
    summary: [
      `${title} should be read as a self-report formulation rather than a conclusion. The main scored signal is: ${analysis?.summary || patterns || 'not enough scored data to summarise.'}`,
      'The useful question is what this pattern may look like in ordinary life: what tends to happen first under stress, what resources become available later, and where a helpful response might turn costly if it becomes automatic.',
    ].join('\n\n'),
    sections: [
      {
        title: 'Overall formulation',
        body: patterns
          ? [
            `The strongest scored areas were ${patterns}. Those scores are evidence, not the whole interpretation.`,
            'A more useful reading is to ask what those signals might mean together. They may describe a pattern of attention, emotion, self-protection, problem-solving, or support-seeking that becomes more visible when pressure is high.',
          ].join('\n\n')
          : [
            'No dominant scored areas stood out strongly. That can mean the profile is relatively even, or that the useful information is in smaller contrasts between scales.',
            'In that case, the most useful interpretation is situational: which circumstances pull one response forward, and which circumstances allow more flexible coping or self-understanding?',
          ].join('\n\n'),
      },
      {
        title: 'How it may show up',
        body: [
          'Treat higher scores as areas endorsed more strongly in this specific self-report context. They may show up as the first thing the person notices, the explanation they reach for, the behaviour they use to regain control, or the kind of support they find easiest to accept.',
          'The same pattern can be useful in one context and costly in another. A response that helps someone survive the first hour of stress may not be the response that helps them recover over days or weeks.',
        ].join('\n\n'),
      },
      {
        title: 'Practical reflection',
        body: [
          'Look for one pattern that feels accurate, one that feels surprising, and one that may depend heavily on the week the check was completed.',
          'The best next reflection is not "is this label correct?" but "where do I recognise this sequence, and where could I intervene earlier?"',
        ].join('\n\n'),
      },
    ],
    questions: [
      'Which part of this result feels most accurate right now?',
      'Which part would someone who knows you well question or qualify?',
      'What recent situation might have influenced these answers?',
    ],
    caveat: 'This is a proof-of-concept self-report interpretation, not professional advice, diagnosis, or a substitute for a qualified professional.',
  };
}

function buildPrompt({ title, purpose, scores, existingAnalysis }) {
  return [
    `Create a thoughtful self-report interpretation for: ${title}.`,
    '',
    `Purpose/context: ${purpose}`,
    '',
    'Important constraints:',
    '- This is proof-of-concept self-reflection only.',
    '- Do not diagnose, treat, predict risk, or give professional advice.',
    '- Do not overstate certainty. Explain what patterns might suggest and what could be context-dependent.',
    '- Be more insightful than a score summary: discuss tensions, possible interactions, and practical reflection points.',
    '- Write at the same interpretive depth as an integrated profile: explain what the pattern may look like in real life, what may happen first, what may become available later, what strengths are present, and what could become costly.',
    '- Do not make any section a list of elevated scales or symptoms. Scale names should be evidence for an interpretation, not the interpretation itself.',
    '- Use paragraph breaks inside JSON string values. The summary should be 2 short paragraphs separated by "\\n\\n". Each section body should be 1-2 short paragraphs separated by "\\n\\n" where helpful.',
    '- Return ONLY valid JSON with this shape:',
    '{"summary":"paragraph one\\n\\nparagraph two","sections":[{"title":"Overall formulation","body":"paragraph one\\n\\nparagraph two"},{"title":"How this may show up","body":"..."},{"title":"Strengths and risks","body":"..."},{"title":"Useful reflection","body":"..."}],"questions":["..."],"caveat":"..."}',
    '',
    `Existing deterministic analysis:\n${JSON.stringify(existingAnalysis || {}, null, 2).slice(0, 5000)}`,
    '',
    `Scored data:\n${JSON.stringify(scores || {}, null, 2).slice(0, 9000)}`,
  ].join('\n');
}

async function generateModelInsight(userId, options) {
  const fallback = fallbackInsight(options);
  try {
    const { standard, light } = await getModelsForUser(userId);
    const model = standard || light;
    if (!model) {
      return {
        ...normaliseInsight(null, fallback),
        variant,
      };
    }

    const text = await callModel(model, buildPrompt(options), {
      maxTokens: 1800,
      system: 'You write careful, nuanced self-report assessment interpretations. You are not a clinician and must avoid diagnosis or treatment advice. Return only valid JSON.',
    });
    return normaliseInsight(safeJsonParse(text), fallback);
  } catch (err) {
    return {
      ...normaliseInsight(null, fallback),
      modelError: String(err.message || err).slice(0, 300),
    };
  }
}

function latestScoreLinesFromScales(scales, count = 6) {
  return [...(scales || [])]
    .sort((a, b) => Number(b.normalized || 0) - Number(a.normalized || 0))
    .slice(0, count)
    .map((scale) => `${scale.label || scale.key}: ${scale.score}/${scale.max} (${scale.band})`);
}

function compactScale(scale) {
  if (!scale) return null;
  return {
    key: scale.key || scale.code,
    label: scale.label,
    domain: scale.domainLabel || scale.domain,
    score: scale.score,
    max: scale.max,
    band: scale.band,
    normalized: Number(scale.normalized || 0),
    description: scale.description,
  };
}

function topByNormalized(scales, count = 5) {
  return [...(scales || [])]
    .sort((a, b) => Number(b.normalized || 0) - Number(a.normalized || 0))
    .slice(0, count)
    .map(compactScale)
    .filter(Boolean);
}

function bottomByNormalized(scales, count = 5) {
  return [...(scales || [])]
    .sort((a, b) => Number(a.normalized || 0) - Number(b.normalized || 0))
    .slice(0, count)
    .map(compactScale)
    .filter(Boolean);
}

function allCompactScales(scales) {
  return [...(scales || [])].map(compactScale).filter(Boolean);
}

function strongestByDistance(scales, count = 8) {
  return [...(scales || [])]
    .sort((a, b) => Math.abs(Number(b.normalized || 0) - 0.5) - Math.abs(Number(a.normalized || 0) - 0.5))
    .slice(0, count)
    .map(compactScale)
    .filter(Boolean);
}

function sentenceList(items) {
  return items.filter(Boolean).join('; ');
}

function labels(items) {
  return (items || []).map((item) => item.label).filter(Boolean);
}

function hasAny(items, keys) {
  const keySet = new Set(keys);
  return (items || []).some((item) => keySet.has(item.key));
}

function highKeys(items) {
  return (items || []).filter((item) => Number(item.normalized || 0) >= 0.62).map((item) => item.key);
}

function describeMood(latest) {
  const topAreas = latest.mood.analysis?.topAreas || latest.mood.analysis?.rationale?.drivers || [];
  const areas = topAreas.slice(0, 4).map((area) => area.topic).filter(Boolean);
  const areaText = areas.length ? ` The main signals behind that score appear to be ${sentenceList(areas)}.` : '';
  return `The mood check is best treated as the emotional weather around the rest of the profile: it scored ${latest.mood.totalScore}/63, in the "${latest.mood.bandLabel}" range.${areaText} If that score is elevated, the other tests may partly reflect how the person answers when tired, discouraged, self-critical, or under strain, rather than only stable long-term style.`;
}

function describePersonality(scores) {
  const high = labels(scores.personality.highDomains).slice(0, 3);
  const low = labels(scores.personality.lowDomains).slice(0, 2);
  const facets = labels(scores.personality.strongestFacets).slice(0, 5);
  return [
    high.length
      ? `The personality pattern suggests the person's default style is organised around ${sentenceList(high)}.`
      : 'The personality pattern does not show one dominant broad domain, which may point to a more context-sensitive style.',
    low.length
      ? ` Lower relative areas such as ${sentenceList(low)} may describe situations that require more deliberate effort or feel less natural.`
      : '',
    facets.length
      ? ` The facet signals add texture: ${sentenceList(facets)} are likely to be more visible in everyday behaviour than the broad domain names alone.`
      : '',
    'The useful interpretation is not "this is who the person is", but "this is the starting posture they may bring into stress, relationships, decisions, and recovery".',
  ].join('');
}

function describeHexacoPersonality(scores) {
  const high = labels(scores.hexacoPersonality?.highDomains || []).slice(0, 3);
  const low = labels(scores.hexacoPersonality?.lowDomains || []).slice(0, 2);
  if (!high.length && !low.length) {
    return 'The HEXACO-style personality lens does not show one dominant six-domain pattern, so it should be used mainly as a comparison point against the IPIP-style profile.';
  }
  return [
    high.length
      ? `The HEXACO-style lens adds six-domain context, with stronger relative endorsement in ${sentenceList(high)}.`
      : '',
    low.length
      ? ` Lower relative HEXACO-style domains such as ${sentenceList(low)} may qualify how the broader personality pattern shows up in relationships, stress, and self-regulation.`
      : '',
    ' This is useful because Honesty-Humility and Emotionality can add interpersonal and attachment-related nuance that the IPIP-style five-domain lens may not fully capture.',
  ].join('');
}

function describeCognitiveCoping(scores) {
  const high = scores.cognitiveCoping.highScales || [];
  const keys = highKeys(high);
  const constructive = hasAny(high, ['positiveReappraisal', 'positiveRefocusing', 'planning', 'perspective', 'acceptance']);
  const sticky = hasAny(high, ['rumination', 'catastrophizing', 'selfBlame', 'otherBlame']);
  const labelsText = sentenceList(labels(high).slice(0, 5));

  if (constructive && sticky) {
    return `The cognitive coping pattern looks mixed rather than simply "good" or "bad". There are signs of meaning-making or perspective-building, but also signs that stressful events may be mentally replayed, blamed, or amplified before they settle. In practice, this can feel like a person who can eventually find a constructive frame, but may first spend time circling the event, testing what it says about them or others, and trying to make the distress intellectually coherent. The scale evidence for this reading is ${labelsText}.`;
  }
  if (constructive) {
    return `The cognitive coping pattern suggests the person often tries to organise distress into something understandable or workable. Rather than only reacting emotionally, they may look for perspective, acceptance, a possible lesson, or a next step. This can be stabilising, although it may become costly if it turns too quickly into "making the best of it" before the emotional reality has been properly acknowledged. The scale evidence for this reading is ${labelsText}.`;
  }
  if (sticky) {
    return `The cognitive coping pattern suggests stress may stay active in the mind after the event itself. The person may replay what happened, search for blame, imagine worse implications, or keep returning to the emotional meaning of the situation. This can reflect a serious effort to understand the event, but it may also delay recovery if thinking becomes repetitive rather than clarifying. The scale evidence for this reading is ${labelsText}.`;
  }
  return `The cognitive coping profile is relatively diffuse. No single mental strategy appears to dominate, so the important question is probably situational: which kinds of stress pull the person toward analysis, acceptance, blame, perspective, or avoidance? The highest cognitive scale evidence is ${labelsText || 'not strongly differentiated'}.`;
}

function describeBehaviouralCoping(scores) {
  const high = scores.copingStyle.highScales || [];
  const keys = highKeys(high);
  const support = hasAny(high, ['instrumentalSupport', 'emotionalSupport']);
  const problem = hasAny(high, ['activeCoping', 'planning']);
  const meaning = hasAny(high, ['positiveReframing', 'acceptance', 'religion', 'humor']);
  const avoidant = hasAny(high, ['denial', 'behavioralDisengagement', 'selfDistraction', 'substanceUse']);
  const selfBlame = keys.includes('selfBlame');
  const evidence = sentenceList(labels(high).slice(0, 6));

  if ((support || problem || meaning) && (avoidant || selfBlame)) {
    return `Behaviourally, the profile suggests a person with several constructive coping routes available, but not a clean or effortless route into them. They may reach for advice, emotional reassurance, planning, acceptance, faith, or reframing, which means they are not simply passive under stress. At the same time, the presence of self-blame or denial-type responses suggests the first phase of coping may involve recoil: minimising what is happening, privately blaming themselves, or needing time before they can use the more constructive strategies they also endorse. In real life this can look like "I know what would help, and I may even seek it, but part of me is still criticising myself or not fully facing the situation." The score evidence for this formulation is ${evidence}.`;
  }
  if (support && problem) {
    return `Behaviourally, the person appears likely to cope by moving toward people and structure. They may ask for advice, gather practical help, talk things through, and turn stress into a plan. This is usually a useful profile when the situation is changeable, but it can become frustrating when the stressor is ambiguous, slow-moving, or outside their control. The score evidence for this formulation is ${evidence}.`;
  }
  if (meaning && !avoidant) {
    return `Behaviourally, the person appears to cope by making meaning: accepting what cannot be changed, reframing the event, using faith or values, or finding a wider perspective. This can protect against despair, but it may also hide unmet needs if meaning-making happens before the person has asked for help or taken practical steps. The score evidence for this formulation is ${evidence}.`;
  }
  if (avoidant || selfBlame) {
    return `Behaviourally, stress may first produce withdrawal, delay, minimisation, or self-criticism. These responses can reduce emotional intensity in the short term, but they may leave the underlying problem untouched or make the person feel more alone with it. The important distinction is whether these responses are brief pauses before re-engaging, or whether they become the main coping route. The score evidence for this formulation is ${evidence}.`;
  }
  return `Behaviourally, the coping pattern is not dominated by one route. The person may shift between strategies depending on whether the stressor calls for action, support, emotional release, or acceptance. The practical question is which strategy they use first under pressure, and whether that first move helps or delays recovery. The strongest score evidence is ${evidence || 'not strongly differentiated'}.`;
}

function describeReinforcingThemes(latest, scores) {
  const behavioural = describeBehaviouralCoping(scores);
  const cognitive = describeCognitiveCoping(scores);
  const hexaco = describeHexacoPersonality(scores);
  return `The clearest combined themes are found where the same pattern appears in different languages. The mood score sets the current emotional load; the two personality lenses describe the posture the person may bring into stress and relationships; the cognitive profile shows how stress is explained internally; and the behavioural coping profile shows what the person does with that explanation. Read together, the profile asks whether the person moves from distress into constructive contact, planning, meaning, and recovery, or whether the distress first becomes self-criticism, denial, rumination, or delay. ${describeMood(latest)} ${hexaco} ${cognitive} ${behavioural}`;
}

function describeTensions(scores) {
  const behaviourHigh = scores.copingStyle.highScales || [];
  const support = hasAny(behaviourHigh, ['instrumentalSupport', 'emotionalSupport']);
  const avoidant = hasAny(behaviourHigh, ['denial', 'behavioralDisengagement', 'selfDistraction', 'substanceUse']);
  const selfBlame = hasAny(behaviourHigh, ['selfBlame']);
  const meaning = hasAny(behaviourHigh, ['positiveReframing', 'acceptance', 'religion']);

  if (support && (avoidant || selfBlame)) {
    return 'A major tension is that the person may be able to reach outward while still turning inward harshly. They may seek advice or reassurance, but privately carry blame, embarrassment, or reluctance to fully name the problem. That matters because support may be available, but not fully usable unless the self-critical or avoidant layer is recognised.';
  }
  if (meaning && avoidant) {
    return 'A possible tension is between acceptance and avoidance. Acceptance can mean clear-eyed acknowledgement; avoidance can look superficially similar but has a different effect. The question is whether the person is making peace with reality, or moving too quickly past something that still needs action, grief, or conversation.';
  }
  return 'The main tension to look for is the gap between ordinary style and stressed style. A person can be thoughtful, conscientious, relational, or resilient in general, yet still show a different pattern when pressure is high. The profile is most useful when it identifies that shift rather than treating every score as a fixed trait.';
}

function describeStrengths(scores) {
  const behaviourHigh = scores.copingStyle.highScales || [];
  const cognitiveHigh = scores.cognitiveCoping.highScales || [];
  const strengths = [];
  if (hasAny(behaviourHigh, ['instrumentalSupport', 'emotionalSupport'])) strengths.push('access to other people as a coping resource');
  if (hasAny(behaviourHigh, ['activeCoping', 'planning'])) strengths.push('capacity to convert stress into concrete steps');
  if (hasAny(behaviourHigh, ['positiveReframing', 'acceptance', 'religion', 'humor'])) strengths.push('ability to create meaning or perspective under pressure');
  if (hasAny(cognitiveHigh, ['positiveReappraisal', 'perspective', 'acceptance', 'planning'])) strengths.push('mental strategies that can restore perspective');
  if (!strengths.length) strengths.push('the ability to notice patterns clearly enough to reflect on them');
  return `The strengths suggested by the profile are ${sentenceList(strengths)}. These strengths matter most when used deliberately rather than automatically. For example, support is more useful when the person asks for the kind of help they actually need; planning is more useful when paired with emotional acknowledgement; reframing is more useful after the reality of the situation has been faced.`;
}

function describeGrowthEdges(scores) {
  const behaviourHigh = scores.copingStyle.highScales || [];
  const cognitiveHigh = scores.cognitiveCoping.highScales || [];
  const edges = [];
  if (hasAny(behaviourHigh, ['selfBlame'])) edges.push('noticing when responsibility turns into global self-criticism');
  if (hasAny(behaviourHigh, ['denial', 'behavioralDisengagement', 'selfDistraction', 'substanceUse'])) edges.push('catching the moment when short-term relief becomes avoidance');
  if (hasAny(cognitiveHigh, ['rumination', 'catastrophizing', 'selfBlame', 'otherBlame'])) edges.push('separating useful reflection from repetitive mental replay');
  if (!edges.length) edges.push('matching the coping strategy to the actual problem rather than using the same strategy for every stressor');
  return `The growth edge is ${sentenceList(edges)}. A useful profile should not leave the reader with a label; it should help them spot an earlier decision point. The practical question is: "What is the first move I make under stress, and does it still help after the first few minutes or hours?"`;
}

function buildCombinedFallback(latest, scores) {
  const moodLine = `The mood check sits at ${latest.mood.totalScore}/63, in the "${latest.mood.bandLabel}" range.`;
  const highDomains = scores.personality.highDomains.map((item) => `${item.label} (${item.band})`);
  const lowDomains = scores.personality.lowDomains.map((item) => `${item.label} (${item.band})`);
  const hexacoDomains = (scores.hexacoPersonality?.highDomains || []).map((item) => `${item.label} (${item.band})`);
  const cerqHigh = scores.cognitiveCoping.highScales.map((item) => `${item.label} (${item.band})`);
  const copeHigh = scores.copingStyle.highScales.map((item) => `${item.label} (${item.band})`);
  const mood = describeMood(latest);
  const personality = describePersonality(scores);
  const hexacoPersonality = describeHexacoPersonality(scores);
  const cognitive = describeCognitiveCoping(scores);
  const behavioural = describeBehaviouralCoping(scores);

  return {
    summary: [
      `${moodLine} The combined profile is most useful when read as a working formulation: current emotional load, habitual personality posture, the way stress is explained internally, and the actions used to cope.`,
      `${personality} ${hexacoPersonality} ${cognitive}`,
      behavioural,
    ].join('\n\n'),
    sections: [
      {
        title: 'Overall formulation',
        body: [
          `This profile should be read as a working hypothesis rather than a set of labels. ${mood}`,
          'The personality results describe the posture the person may bring into stress, while the CERQ-style and COPE-style results describe what happens after stress arrives: first in thought, then in action. The most useful reading is not "these scales were high"; it is "this is the kind of loop the person may enter, the resources they may reach for, and the points where coping may either help recovery or accidentally keep stress alive."',
        ].join('\n\n'),
      },
      {
        title: 'Mood and energy context',
        body: mood,
      },
      {
        title: 'Personality pattern',
        body: [
          personality,
          hexacoPersonality,
          `The evidence behind this includes IPIP-style higher relative domain signals of ${sentenceList(highDomains) || 'none clearly dominant'} and lower relative signals of ${sentenceList(lowDomains) || 'none clearly low'}. The HEXACO-style lens adds higher relative six-domain signals of ${sentenceList(hexacoDomains) || 'none clearly dominant'}. These names are evidence for the formulation rather than the formulation itself.`,
        ].join('\n\n'),
      },
      {
        title: 'Cognitive coping pattern',
        body: [
          cognitive,
          `The score evidence includes ${sentenceList(cerqHigh) || 'no clear dominant strategy'}, but the important issue is whether thinking becomes clarifying, compassionate, and action-guiding, or repetitive and emotionally intensifying.`,
        ].join('\n\n'),
      },
      {
        title: 'Behavioural coping pattern',
        body: [
          behavioural,
          `The score evidence includes ${sentenceList(copeHigh) || 'no clear dominant strategy'}, but the real-world question is sequence: what happens first, what becomes available later, and which coping response actually changes the situation or helps the person recover?`,
        ].join('\n\n'),
      },
      {
        title: 'Reinforcing themes',
        body: describeReinforcingThemes(latest, scores),
      },
      {
        title: 'Tensions and qualifications',
        body: describeTensions(scores),
      },
      {
        title: 'Strengths and supports',
        body: describeStrengths(scores),
      },
      {
        title: 'Growth edges',
        body: describeGrowthEdges(scores),
      },
    ],
    questions: [
      'Which pattern appears in at least two of the five tests?',
      'Which result feels more like a current state than a stable trait?',
      'Under stress, do your coping responses move you toward support and action or toward withdrawal and short-term relief?',
      'What is one useful strength shown by the profile that you may underuse?',
      'What is one repeated loop you could interrupt earlier?',
      'What would someone close to you recognise immediately in this profile?',
    ],
    caveat: 'This combined profile is a proof-of-concept self-report synthesis. It is not a diagnosis, clinical assessment, risk assessment, or substitute for a qualified professional.',
  };
}

function buildCombinedSummaryFallback(latest, scores) {
  const mood = `Mood score: ${latest.mood.totalScore}/63 (${latest.mood.bandLabel}).`;
  const highDomains = scores.personality.highDomains.slice(0, 2).map((item) => `${item.label} (${item.band})`);
  const hexacoDomains = (scores.hexacoPersonality?.highDomains || []).slice(0, 2).map((item) => `${item.label} (${item.band})`);
  const cerqHigh = scores.cognitiveCoping.highScales.slice(0, 3).map((item) => `${item.label} (${item.band})`);
  const copeHigh = scores.copingStyle.highScales.slice(0, 3).map((item) => `${item.label} (${item.band})`);

  return {
    summary: [
      `${mood} The five tests together give a broad self-report overview of current mood load, two personality lenses, cognitive coping, and practical coping responses.`,
      `The most visible pattern is shaped by IPIP-style signals such as ${sentenceList(highDomains) || 'no strongly dominant personality domain'}, HEXACO-style signals such as ${sentenceList(hexacoDomains) || 'no strongly dominant six-domain signal'}, cognitive strategies such as ${sentenceList(cerqHigh) || 'no clearly dominant CERQ-style strategy'}, and coping responses such as ${sentenceList(copeHigh) || 'no clearly dominant COPE-style response'}.`,
    ].join('\n\n'),
    sections: [
      {
        title: 'Plain-language overview',
        body: 'This summary is designed to be quickly readable by either the client or a clinician. It should orient the reader to the main pattern before they decide whether to read the full detailed profile.',
      },
      {
        title: 'Main signals',
        body: `${mood} IPIP personality signals: ${sentenceList(highDomains) || 'balanced or not strongly differentiated'}. HEXACO personality signals: ${sentenceList(hexacoDomains) || 'balanced or not strongly differentiated'}. Cognitive coping signals: ${sentenceList(cerqHigh) || 'not strongly differentiated'}. Behavioural coping signals: ${sentenceList(copeHigh) || 'not strongly differentiated'}.`,
      },
      {
        title: 'What to look at next',
        body: 'The detailed profile is the best next step for client-readable formulation. The analytical profile is more suitable when a clinician wants a more technical cross-test formulation and hypotheses to consider.',
      },
    ],
    questions: [
      'Which one part of this summary feels most recognisable?',
      'Which result seems most state-dependent rather than enduring?',
      'Which area would be most useful to explore in more detail?',
    ],
    caveat: 'This summary is a proof-of-concept self-report synthesis. It is not a diagnosis, clinical assessment, risk assessment, or substitute for a qualified professional.',
  };
}

function buildCombinedAnalyticalFallback(latest, scores) {
  const detailed = buildCombinedFallback(latest, scores);
  return {
    summary: [
      'This analytical profile is intended as a clinician-oriented formulation aid based on self-report data. It should be read as hypothesis generation, not diagnostic evidence.',
      detailed.summary,
    ].join('\n\n'),
    sections: [
      {
        title: 'Clinical formulation hypotheses',
        body: [
          describeReinforcingThemes(latest, scores),
          'The relevant clinical question is whether the observed pattern is stable across contexts or primarily activated under current mood load, stress, relational pressure, or threat appraisal.',
        ].join('\n\n'),
      },
      {
        title: 'State-trait-context distinction',
        body: [
          describeMood(latest),
          describePersonality(scores),
          'Mood load may inflate negative appraisal, reduce access to behavioural resources, or make some trait tendencies appear more extreme. The profile should therefore be interpreted as current presentation plus trait-style hypotheses, not as a fixed description.',
        ].join('\n\n'),
      },
      {
        title: 'Cognitive-affective mechanisms',
        body: [
          describeCognitiveCoping(scores),
          'Clinically, the useful focus is not just which cognitive strategies are frequent, but whether they increase threat, shame, helplessness, interpersonal distance, or problem-solving clarity.',
        ].join('\n\n'),
      },
      {
        title: 'Behavioural coping sequence',
        body: [
          describeBehaviouralCoping(scores),
          'Assess sequence: immediate response, short-term relief, delayed cost, and whether coping increases agency, support, avoidance, or self-criticism over time.',
        ].join('\n\n'),
      },
      {
        title: 'Protective factors and treatment-relevant strengths',
        body: describeStrengths(scores),
      },
      {
        title: 'Risk-sensitive caveats',
        body: 'This profile is not a risk assessment. Any safety-related mood item, significant functional decline, substance-related coping, or marked hopelessness should be followed up through appropriate clinical assessment rather than inferred from this tool alone.',
      },
      {
        title: 'Suggested clinical questions',
        body: [
          'What contexts reliably activate the strongest pattern?',
          'Does the client recognise the cognitive sequence before the behavioural coping response?',
          'Which coping responses produce short-term relief but maintain the problem?',
          'Which protective responses are available but underused under high stress?',
        ].join('\n'),
      },
    ],
    questions: [
      'Which findings are state-dependent and should be rechecked when mood load changes?',
      'Which cross-test theme would be most important to validate clinically?',
      'Where does the sequence move from understandable coping to maintaining cycle?',
      'Which protective factor is most available for intervention planning?',
      'What additional assessment would be needed before making any clinical conclusion?',
    ],
    caveat: 'Clinician-oriented profile for hypothesis generation only. It is based on self-report proof-of-concept tools and is not a diagnosis, risk assessment, treatment plan, or substitute for professional judgement.',
  };
}

function buildCombinedSuggestionsFallback(latest, scores) {
  const mood = describeMood(latest);
  const personality = describePersonality(scores);
  const hexacoPersonality = describeHexacoPersonality(scores);
  const cognitive = describeCognitiveCoping(scores);
  const behavioural = describeBehaviouralCoping(scores);

  return {
    summary: [
      'These suggestions are drawn from the five self-report checks as reflective development prompts. They are not treatment advice, diagnosis, or instructions; they are areas the client may choose to notice, discuss, or strengthen.',
      `${mood} ${personality} ${hexacoPersonality}`,
      'The most useful next step is to look for small, observable moments where the pattern shows up in real life, especially under stress, conflict, fatigue, uncertainty, or pressure.',
    ].join('\n\n'),
    sections: [
      {
        title: 'Strengths to lean on',
        body: describeStrengths(scores),
      },
      {
        title: 'Patterns to notice earlier',
        body: [
          cognitive,
          'A useful development focus is to notice the first mental move after stress: whether the client moves toward perspective, planning, blame, rumination, threat-amplification, or avoidance. The aim is awareness of sequence, not self-criticism.',
        ].join('\n\n'),
      },
      {
        title: 'Coping habits to strengthen',
        body: [
          behavioural,
          'The client may benefit from identifying which coping responses help immediately and which still help a few hours or days later. This distinction can separate short-term relief from strategies that actually restore agency, connection, and clarity.',
        ].join('\n\n'),
      },
      {
        title: 'Relationship and communication focus',
        body: [
          hexacoPersonality,
          'The interpersonal development question is how the client communicates needs under pressure: whether they ask clearly, withdraw, become defensive, over-explain, minimise, or try to manage everything privately. A practical area to strengthen is naming the kind of support needed before the situation escalates.',
        ].join('\n\n'),
      },
      {
        title: 'Personal development experiments',
        body: [
          'Choose one small experiment rather than trying to change the whole pattern at once.',
          'Examples: pause before responding under stress; write down the first interpretation and one alternative; ask for a specific kind of help; turn one worry into a concrete next step; notice when self-blame is becoming global rather than specific; or schedule recovery after demanding social or emotional situations.',
          'The best experiment is the one the client can try safely, observe honestly, and discuss later without treating the result as success or failure.',
        ].join('\n\n'),
      },
      {
        title: 'Areas to discuss with a clinician or trusted support',
        body: 'If any pattern feels intense, persistent, risky, or functionally costly, it should be discussed with a suitably qualified professional. These suggestions can help organise that conversation by pointing to recurring sequences, possible strengths, and places where more assessment or support may be useful.',
      },
    ],
    questions: [
      'Which suggestion feels most immediately recognisable in daily life?',
      'Which strength is present in the profile but harder to access under stress?',
      'What is the first sign that the less-helpful pattern has started?',
      'Which small experiment could be tried for one week and then reviewed?',
      'Who could give useful feedback about whether this pattern is visible from the outside?',
    ],
    caveat: 'These are reflective personal-development suggestions generated from proof-of-concept self-report tools. They are not diagnosis, treatment advice, a risk assessment, or a substitute for professional judgement.',
  };
}

function normaliseCombinedVariant(value) {
  if (value === 'summary' || value === 'analytical' || value === 'suggestions') return value;
  return 'detailed';
}

function buildCombinedFallbackForVariant(latest, scores, variant) {
  if (variant === 'summary') return buildCombinedSummaryFallback(latest, scores);
  if (variant === 'analytical') return buildCombinedAnalyticalFallback(latest, scores);
  if (variant === 'suggestions') return buildCombinedSuggestionsFallback(latest, scores);
  return buildCombinedFallback(latest, scores);
}

function buildCombinedPrompt(scores, variant = 'detailed') {
  if (variant === 'summary') {
    return [
      'Create a brief integrated overview from five completed proof-of-concept self-report checks.',
      '',
      'Audience: client or clinician who wants a quick readable overview before reading the full profile.',
      'Length: concise. Summary should be 2 short paragraphs. Include 3 short sections only.',
      'Tone: plain language, non-clinical, careful, not diagnostic.',
      '',
      'Required sections: "Plain-language overview", "Main signals", "What to look at next".',
      'Avoid long formulation language. Do not list every scale. Mention only the most useful cross-test signals.',
      'Use paragraph breaks inside JSON string values.',
      '',
      'Return ONLY valid JSON with this shape:',
      '{"summary":"paragraph one\\n\\nparagraph two","sections":[{"title":"Plain-language overview","body":"..."},{"title":"Main signals","body":"..."},{"title":"What to look at next","body":"..."}],"questions":["..."],"caveat":"..."}',
      '',
      `Scored data:\n${JSON.stringify(scores, null, 2).slice(0, 14000)}`,
    ].join('\n');
  }

  if (variant === 'analytical') {
    return [
      'Create a clinician-oriented analytical formulation from five completed proof-of-concept self-report checks.',
      '',
      'Audience: primarily a clinician, but still readable by a client if they choose to read it.',
      'Purpose: hypothesis generation, case formulation support, and clinical discussion prompts. Do not diagnose. Do not provide treatment instructions.',
      '',
      'Required emphasis:',
      '- Separate state effects, trait tendencies, cognitive mechanisms, behavioural coping sequences, protective factors, and caveats.',
      '- Use clinical formulation language carefully: hypotheses, maintaining loops, protective factors, vulnerabilities, context dependence, and areas requiring further assessment.',
      '- Identify cross-test convergence and divergence.',
      '- Explicitly state what cannot be concluded from these self-report tools.',
      '- Make it more detailed and analytical than the client-readable detailed profile.',
      '- Use paragraph breaks inside JSON string values.',
      '',
      'Required sections:',
      'Clinical formulation hypotheses; State-trait-context distinction; Cognitive-affective mechanisms; Behavioural coping sequence; Protective factors and treatment-relevant strengths; Risk-sensitive caveats; Suggested clinical questions.',
      '',
      'Return ONLY valid JSON with this shape:',
      '{"summary":"paragraph one\\n\\nparagraph two","sections":[{"title":"Clinical formulation hypotheses","body":"..."},{"title":"State-trait-context distinction","body":"..."},{"title":"Cognitive-affective mechanisms","body":"..."},{"title":"Behavioural coping sequence","body":"..."},{"title":"Protective factors and treatment-relevant strengths","body":"..."},{"title":"Risk-sensitive caveats","body":"..."},{"title":"Suggested clinical questions","body":"..."}],"questions":["..."],"caveat":"..."}',
      '',
      `Scored data:\n${JSON.stringify(scores, null, 2).slice(0, 18000)}`,
    ].join('\n');
  }

  if (variant === 'suggestions') {
    return [
      'Create a reflective personal-development suggestions report from five completed proof-of-concept self-report checks.',
      '',
      'Audience: primarily the client, readable by a clinician. Tone should be practical, warm, specific, and careful.',
      'Purpose: suggest areas the client may notice, strengthen, discuss, or experiment with. Do not diagnose. Do not give treatment instructions. Do not imply certainty.',
      '',
      'Required emphasis:',
      '- Use all five lenses: mood, IPIP-style personality, HEXACO-style personality, CERQ-style cognitive coping, and Brief COPE-style behavioural coping.',
      '- Translate findings into reflective improvement suggestions, not labels.',
      '- Include strengths to lean on, patterns to notice earlier, coping habits to strengthen, interpersonal/communication suggestions, small experiments, and when to discuss with a professional.',
      '- Use tentative wording: may, could, might, worth noticing, useful to explore.',
      '- Avoid prescriptive wording like "you must", "you should", diagnosis, treatment plans, or risk conclusions.',
      '- Use paragraph breaks inside JSON string values.',
      '',
      'Required sections:',
      'Strengths to lean on; Patterns to notice earlier; Coping habits to strengthen; Relationship and communication focus; Personal development experiments; Areas to discuss with a clinician or trusted support.',
      '',
      'Return ONLY valid JSON with this shape:',
      '{"summary":"paragraph one\\n\\nparagraph two","sections":[{"title":"Strengths to lean on","body":"..."},{"title":"Patterns to notice earlier","body":"..."},{"title":"Coping habits to strengthen","body":"..."},{"title":"Relationship and communication focus","body":"..."},{"title":"Personal development experiments","body":"..."},{"title":"Areas to discuss with a clinician or trusted support","body":"..."}],"questions":["..."],"caveat":"..."}',
      '',
      `Scored data:\n${JSON.stringify(scores, null, 2).slice(0, 17000)}`,
    ].join('\n');
  }

  return [
    'Create a detailed integrated profile from five completed proof-of-concept self-report checks.',
    '',
    'The five lenses are:',
    '1. Mood check: current mood/symptom context, not diagnosis.',
    '2. IPIP-NEO-120: broad personality domains and facet tendencies.',
    '3. HEXACO-60-style: six-domain personality posture, especially honesty-humility, emotionality, and interpersonal style.',
    '4. CERQ-style: cognitive emotion-regulation strategies after stress.',
    '5. Brief COPE-style: behavioural/practical coping responses.',
    '',
    'Write a considered synthesis, not a score report. The output should feel like a thoughtful psychologist-style formulation while explicitly avoiding diagnosis, treatment advice, and certainty.',
    '',
    'Required content:',
    '- Explain how current mood may colour or qualify the other three results.',
    '- Identify cross-test themes where two or more tests point in the same direction.',
    '- Identify tensions or contradictions between trait style, cognitive coping, and behavioural coping.',
    '- Describe likely strengths/supports that emerge from the pattern.',
    '- Describe growth edges or situations where the pattern could become costly.',
    '- Include practical reflection prompts, but do not prescribe treatment.',
    '- Use concrete references to the provided scores and scale names.',
    '- Do not make any section a list of elevated scales. Scale names should be evidence for an interpretation, not the interpretation itself.',
    '- For every section, explain what the pattern may look like in real life: first reaction, inner narrative, outward behaviour, likely strengths, likely costs, and what would be worth noticing.',
    '- Where the pattern is mixed, say so. For example, support-seeking plus denial/self-blame should be described as a sequence or tension, not as unrelated traits.',
    '- Avoid generic sentences like "these show what the person tends to do"; replace them with a concrete formulation of how the pattern may play out.',
    '- Use paragraph breaks inside JSON string values. The summary must be 2-3 short paragraphs separated by "\\n\\n". Each section body should be 1-2 readable paragraphs separated by "\\n\\n".',
    '',
    'Return ONLY valid JSON with this shape:',
    '{"summary":"paragraph one\\n\\nparagraph two","sections":[{"title":"Overall formulation","body":"paragraph one\\n\\nparagraph two"},{"title":"Mood and energy context","body":"..."},{"title":"Personality pattern","body":"..."},{"title":"Cognitive coping pattern","body":"..."},{"title":"Behavioural coping pattern","body":"..."},{"title":"Reinforcing themes","body":"..."},{"title":"Tensions and qualifications","body":"..."},{"title":"Strengths and supports","body":"..."},{"title":"Growth edges","body":"..."}],"questions":["..."],"caveat":"..."}',
    '',
    `Scored data:\n${JSON.stringify(scores, null, 2).slice(0, 16000)}`,
  ].join('\n');
}

async function generateCombinedProfile(userId, latest, options = {}) {
  const variant = normaliseCombinedVariant(options.variant);
  const scores = {
    mood: {
      totalScore: latest.mood.totalScore,
      bandLabel: latest.mood.bandLabel,
      analysis: latest.mood.analysis,
      topAreas: latest.mood.analysis?.topAreas || latest.mood.analysis?.rationale?.drivers || [],
    },
    personality: {
      highDomains: topByNormalized(latest.ipip.domainScores, 5),
      lowDomains: bottomByNormalized(latest.ipip.domainScores, 5),
      strongestFacets: strongestByDistance(latest.ipip.facetScores, 12),
      analysis: latest.ipip.analysis,
    },
    hexacoPersonality: {
      highDomains: topByNormalized(latest.hexaco.domainScores, 6),
      lowDomains: bottomByNormalized(latest.hexaco.domainScores, 6),
      allDomains: allCompactScales(latest.hexaco.domainScores),
      analysis: latest.hexaco.analysis,
    },
    cognitiveCoping: {
      allScales: allCompactScales(latest.cerq.scaleScores),
      highScales: topByNormalized(latest.cerq.scaleScores, 7),
      lowScales: bottomByNormalized(latest.cerq.scaleScores, 4),
      analysis: latest.cerq.analysis,
    },
    copingStyle: {
      allScales: allCompactScales(latest.cope.scaleScores),
      highScales: topByNormalized(latest.cope.scaleScores, 8),
      lowScales: bottomByNormalized(latest.cope.scaleScores, 5),
      analysis: latest.cope.analysis,
    },
  };

  const fallback = buildCombinedFallbackForVariant(latest, scores, variant);
  try {
    const { standard, light } = await getModelsForUser(userId);
    const model = standard || light;
    if (!model) return normaliseInsight(null, fallback);

    const text = await callModel(model, buildCombinedPrompt(scores, variant), {
      maxTokens: variant === 'summary' ? 1600 : variant === 'analytical' ? 4600 : variant === 'suggestions' ? 3600 : 3600,
      system: 'You write careful, integrated self-report profile formulations. You are not a clinician and must avoid diagnosis, treatment advice, or unsupported certainty. Return only valid JSON.',
    });
    return {
      ...normaliseInsight(safeJsonParse(text), fallback),
      variant,
    };
  } catch (err) {
    return {
      ...normaliseInsight(null, fallback),
      modelError: String(err.message || err).slice(0, 300),
      variant,
    };
  }
}

module.exports = {
  generateModelInsight,
  generateCombinedProfile,
  latestScoreLinesFromScales,
};
