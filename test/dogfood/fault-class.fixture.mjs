// Parsed as source, never executed. Nested keys and diagnostics are not reasons.
demand(exactKeys(value, ["not-a-reason", "nor-this-key"]), "author-failed");
demand(exactKeys(value, "split-key-one split-key-two".split(" ")), "author-malformed");
requireThat(value, `gate-host-failed:${gate}`);
new QueueBlocked("issue-observation-unavailable", "not-a-diagnostic-reason");
new DeliveryBlocked(`hosted-check-failed:${check}`);
new SetupBlocked("invalid-setup-fixture");
new RepairBlocked("operator-evidence-failed");
new QueueBlocked(condition ? "merge-queue-removed" : "merge-queue-admission-unconfirmed");
