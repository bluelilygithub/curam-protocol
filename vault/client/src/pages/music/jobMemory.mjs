// A music job normally lives only while the Music page is open (leaving deletes its files). When the person
// sends a result to Video Tools ("Finish in Video Tools"), they will want to come back to the other options, so
// the page marks the job to be kept and picks it up again when it is next opened. Memory only: a reload forgets it
// (the server deletes the files itself after about 90 minutes).

let kept = null;

/** Keep this job's files when the Music page unmounts (it is about to hand a result to another page). */
export function keepJobForReturn(jobId) {
  kept = jobId || null;
}

/** True while `jobId` is marked to be kept (used by the page's clean-up on leaving). */
export function shouldKeepJob(jobId) {
  return kept !== null && kept === jobId;
}

/** The job id to restore on opening the page, once; forgets it. */
export function takeKeptJob() {
  const id = kept;
  kept = null;
  return id;
}
