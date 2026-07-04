export interface DogfoodTranscriptEvidence {
    blockQuote?: string;
    passQuote?: string;
    missing: Array<'BLOCK' | 'PASS'>;
}
export declare function redactTranscriptEvidence(value: string): string;
export declare function extractDogfoodTranscriptEvidence(transcript: string): DogfoodTranscriptEvidence;
//# sourceMappingURL=transcript-evidence.d.ts.map