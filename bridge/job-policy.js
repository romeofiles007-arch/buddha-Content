// Publishing is not idempotent. Lost results must be reviewed, never replayed.
export const canRetryJob = job => job.payload?.noRetry !== true && !(job.agent === 'tiktok' && job.kind === 'tiktok-post')
export const canDispatchJob = (job, jobs) => job.status === 'queued' && !job.cancelled && (job.agent !== 'tiktok' || ![...jobs].some(other => other.id !== job.id && other.agent === 'tiktok' && other.status === 'running'))
