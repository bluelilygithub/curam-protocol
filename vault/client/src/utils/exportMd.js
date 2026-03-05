// Parse "[Files: a.pdf, b.jpg]\nuser text" from DB-stored messages
function parseFilesPrefix(content) {
  const match = content?.match(/^\[Files: ([^\]]+)\]\n?([\s\S]*)$/);
  if (!match) return { fileNames: [], text: content || '' };
  return { fileNames: match[1].split(', ').map(s => s.trim()), text: match[2].trim() };
}

function slugify(str) {
  return (str || 'export')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

function downloadBlob(content, filename, type = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadChatMd(messages, sessionTitle, projectName) {
  const lines = [];
  const title = sessionTitle || 'Chat Session';
  lines.push(`# ${title}`);
  if (projectName) lines.push(`\n**Project:** ${projectName}`);
  lines.push(`**Exported:** ${new Date().toLocaleString()}`);
  lines.push('\n---\n');

  for (const msg of messages) {
    const { fileNames, text } = parseFilesPrefix(msg.content);
    if (msg.role === 'user') {
      lines.push('**You**\n');
      if (fileNames.length > 0) lines.push(`*Attached: ${fileNames.join(', ')}*\n`);
      if (text) lines.push(text);
    } else {
      lines.push('**Claude**\n');
      lines.push(msg.content || '');
    }
    lines.push('\n---\n');
  }

  downloadBlob(lines.join('\n'), `${slugify(title)}.md`);
}

export function downloadResponseMd(content, date) {
  const lines = [];
  lines.push('# Claude Response');
  if (date) lines.push(`\n*${new Date(date).toLocaleString()}*`);
  lines.push('\n---\n');
  lines.push(content || '');
  const filename = `response-${Date.now()}.md`;
  downloadBlob(lines.join('\n'), filename);
}

export function downloadProjectMd(project) {
  const lines = [`# ${project.name}`];
  lines.push(`\n*Updated: ${new Date(project.updatedAt).toLocaleDateString()}*\n`);

  const fields = [
    ['Goal', project.goal],
    ['Problem Being Solved', project.problem],
    ['Target Audience', project.audience],
    ['Tech Stack', project.techStack],
    ['Constraints', project.constraints],
    ['Success Criteria', project.successCriteria],
    ['Communication Tone', project.tone],
    ['Notes', project.notes],
  ];
  for (const [label, value] of fields) {
    if (value) {
      lines.push(`## ${label}\n`);
      lines.push(`${value}\n`);
    }
  }

  downloadBlob(lines.join('\n'), `${slugify(project.name)}-project.md`);
}
