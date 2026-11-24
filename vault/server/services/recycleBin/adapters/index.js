'use strict';

// One line per tool that uses the recycle bin. A tool's adapter file registers itself when required. See docs/recycle-bin.md.
require('./notes');
require('./tasks'); // tasks and goals
require('./chats');
require('./routeTracks');
require('./domainSets');
require('./bip'); // Business Profiler profiles (with their per-module source history)
require('./graphicsRecipes');
require('./topicResearch');
require('./passwordVault');
require('./emailFollowUp');
require('./youtube'); // saved lists, follows, favourites
require('./serpTracker'); // saved SERP Tracker lookups
require('./serpSite'); // SERP Tracker sites (with their saved lookups)
require('./sharesThesis'); // Shares theses (with their check history)
require('./sharesCompliance'); // Shares compliance reports (with their source snapshots)
require('./financeCompliance'); // Finance compliance reports (with their source snapshots)
require('./drawings'); // saved Excalidraw drawings
require('./sketchbook'); // Sketchbook cartoon pictures
require('./plans'); // Plans (with their steps, dependencies and links)
require('./presentations'); // Presentations decks and saved themes
require('./translate'); // Translate: translations (with their files) and glossaries
require('./ponytailTasks'); // Ponytail report tasks (admin)
require('./pdfSignatures'); // PDF Tools → Signed PDFs (signing record + kept copy)
require('./skillScan'); // Skill Scanner scans (admin)
require('./tickets'); // Tickets (with their comments and history)
