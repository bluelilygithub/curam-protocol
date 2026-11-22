import React from 'react';
import Tooltip from '../../components/Tooltip';
import { CARD, FIELD, FOCUS_RING, PrimaryButton, UploadDropZone } from './shared';
import { useContractReview } from './context';

// New review: a title and a PDF or DOCX, then Upload & review.
export default function NewReviewView() {
  const { newTitle, setNewTitle, newFile, setNewFile, contract, review, createContract } = useContractReview();

  return (
    <div className="rounded-lg border p-4 mb-6" style={CARD} data-tour="contract-review-upload">
      <h2 className="text-base font-semibold mb-3">New contract review</h2>
      <Tooltip text="A short label to find this contract again later — doesn't affect the analysis.">
        <input
          type="text" placeholder="Contract title" value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className={`w-full rounded border px-3 py-2 text-sm mb-3 ${FOCUS_RING}`} style={FIELD}
        />
      </Tooltip>
      <Tooltip text="PDF or DOCX only. This kicks off extraction, segmentation, type detection, and party extraction.">
        <div className="mb-3">
          <UploadDropZone file={newFile} onFile={setNewFile} />
        </div>
      </Tooltip>
      <PrimaryButton onClick={createContract} disabled={!newTitle.trim() || !newFile} large>
        Upload &amp; review
      </PrimaryButton>
    </div>
  );
}
