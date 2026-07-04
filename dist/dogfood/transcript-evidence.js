import { redactTokens } from '../notifications/redact.js';
function collectText(value, output) {
    if (typeof value === 'string') {
        output.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collectText(item, output);
        return;
    }
    if (!value || typeof value !== 'object')
        return;
    const record = value;
    collectText(record.text, output);
    collectText(record.content, output);
    collectText(record.message, output);
}
export function redactTranscriptEvidence(value) {
    return redactTokens(value)
        .replace(/\/home\/[^/\\\s"']+\/\.claude\/[^\s"']*/g, '[CLAUDE_PROFILE_PATH]')
        .replace(/\/home\/[^/\\\s"']+\/\.codex\/[^\s"']*/g, '[CODEX_PROFILE_PATH]')
        .replace(/\/home\/[^/\\\s"']+\/[^\s"']*(?:session|profile|cookie|credential)[^\s"']*/gi, '[SENSITIVE_PATH]');
}
export function extractDogfoodTranscriptEvidence(transcript) {
    const lines = [];
    for (const rawLine of transcript.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line)
            continue;
        try {
            collectText(JSON.parse(line), lines);
        }
        catch {
            lines.push(line);
        }
    }
    let blockQuote;
    let passQuote;
    for (const line of lines.flatMap((entry) => entry.split(/\r?\n/))) {
        const clean = redactTranscriptEvidence(line.trim());
        if (!clean)
            continue;
        if (!blockQuote && /\bBLOCK\b/i.test(clean)) {
            blockQuote = clean;
            continue;
        }
        if (blockQuote && !passQuote && /\bPASS\b/i.test(clean))
            passQuote = clean;
        if (blockQuote && passQuote)
            break;
    }
    return {
        blockQuote,
        passQuote,
        missing: [
            ...(blockQuote ? [] : ['BLOCK']),
            ...(passQuote ? [] : ['PASS']),
        ],
    };
}
//# sourceMappingURL=transcript-evidence.js.map