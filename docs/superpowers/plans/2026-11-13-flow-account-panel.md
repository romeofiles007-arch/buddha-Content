# Flow account details identity repair

The remote Flow home on `/u/2/?pli=1` exposes an avatar button named
`รายละเอียดบัญชี` / `Account details`, without the current email. Opening it
reveals the named account settings dialog, the current email as static text,
and the close-account-panel button. Version 1.0.56 therefore failed before
generation despite the selected account having 50 credits.

Keep the existing labelled-control identity path. When absent, inspect only the
named account dialog and accept exactly one email from its descendants. Open
only a unique exact account-details button. Close only the panel opened by the
checker; preserve a panel already open. Reject ambiguous emails and navigation
during verification. Never infer identity from the account URL, prompt text,
account chooser, or another project. Keep quota and account rotation policies.

Add an identity-only option to the existing account inspection job so deployment
can be verified without account switching or generation. Release as 1.0.57.

Validation: reproduce missing identity in the new panel fixtures before repair;
run account/rotation/quota, Flow batch/download/progress and updater regressions.
The old quota VM fixtures also need heartbeat timer stubs added since the driver
now starts an interval. Deploy only while the bridge is idle, verify the actual
worker identity, and resume the failed title from its existing stage without
restartFrom, image deletion, or changing the production batch settings.
