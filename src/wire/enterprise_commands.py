"""Compatibility dispatcher from specialized CLI flags to resource APIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode

from .api_client import EnterpriseAPIClient, EnterpriseAPIError


def _print(value: Any) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=False))


def _resource_command_requested(args: Any) -> bool:
    names = (
        "project_create",
        "project_list",
        "project_show",
        "project_plan",
        "project_run",
        "project_add_task",
        "project_delete",
        "project_archive",
        "project_templates",
        "artifact_create",
        "artifact_list",
        "artifact_show",
        "artifact_iterate",
        "artifact_export",
        "artifact_export_all",
        "artifact_diff",
        "artifact_delete",
        "artifact_tag",
        "artifact_attach",
        "artifact_types",
        "research",
        "file_upload",
        "file_list",
        "file_delete",
        "file_ask",
        "file_download",
        "agent_managed_run",
        "agent_memory_store_create",
        "agent_memory_list",
        "agent_memory_stores_list",
        "agent_memory_store_archive",
        "agent_memory_store_delete",
        "agent_memory_get",
        "agent_memory_create",
        "agent_memory_update",
        "agent_memory_delete",
        "agent_dream",
        "agent_dream_get",
        "agent_dream_list",
        "agent_webhook_register",
        "agent_vault_create",
        "agent_vault_add_credential",
        "agent_vault_list",
        "agent_schedule_create",
        "agent_schedule_list",
        "agent_schedule_cancel",
        "agent_review_multiagent",
        "agent_outcome_rubric_upload",
        "agent_env_self_hosted",
        "agent_env_work_stats",
    )
    return any(bool(getattr(args, name, None)) for name in names)


def dispatch_enterprise_resource_command(args: Any) -> bool:
    """Dispatch one known resource command; never execute arbitrary command text."""
    if not _resource_command_requested(args):
        return False
    client = EnterpriseAPIClient.from_env()
    if client is None:
        raise EnterpriseAPIError(
            "This command has migrated to the enterprise API. "
            "Set ZC_API_URL and ZC_API_TOKEN."
        )

    if args.project_templates:
        _print(client.request("GET", "/v1/project-templates")["data"])
    elif args.project_list:
        _print(client.request("GET", "/v1/projects"))
    elif args.project_show:
        _print(client.request("GET", f"/v1/projects/{quote(args.project_show)}")["data"])
    elif args.project_create:
        _print(
            client.request(
                "POST",
                "/v1/projects",
                {
                    "name": args.project_create,
                    "description": args.project_desc,
                    "template": args.project_template,
                },
            )["data"]
        )
    elif args.project_delete:
        client.request("DELETE", f"/v1/projects/{quote(args.project_delete)}")
        print("Deleted.")
    elif args.project_archive:
        _print(
            client.request(
                "PATCH",
                f"/v1/projects/{quote(args.project_archive)}",
                {"status": "archived"},
            )["data"]
        )
    elif args.project_add_task:
        _print(
            client.request(
                "POST",
                f"/v1/projects/{quote(args.project_add_task)}/tasks",
                {
                    "title": args.task_title or args.prompt or "",
                    "description": args.task_desc,
                    "agent": args.task_agent,
                    "priority": args.task_priority,
                },
            )["data"]
        )
    elif args.project_plan:
        _print(
            client.request(
                "POST",
                f"/v1/projects/{quote(args.project_plan)}/plans",
                {"model": args.model},
            )["data"]
        )
    elif args.project_run:
        project_id = quote(args.project_run)
        task_id = args.task or "all"
        if task_id == "all":
            project = client.request("GET", f"/v1/projects/{project_id}")["data"]
            results = []
            for task in project.get("tasks", []):
                if task.get("status") == "todo":
                    results.append(
                        client.request(
                            "POST",
                            f"/v1/projects/{project_id}/tasks/{quote(task['id'])}/runs",
                            {"model": args.model},
                        )["data"]
                    )
            _print(results)
        else:
            _print(
                client.request(
                    "POST",
                    f"/v1/projects/{project_id}/tasks/{quote(task_id)}/runs",
                    {"model": args.model},
                )["data"]
            )
    elif args.artifact_types:
        _print(client.request("GET", "/v1/artifact-types")["data"])
    elif args.artifact_list:
        params = {
            key: value
            for key, value in {
                "artifact_type": (
                    args.artifact_type if args.artifact_type != "code" else None
                ),
                "project_id": args.artifact_project or None,
                "tag": args.tag or None,
                "q": args.artifact_query or None,
            }.items()
            if value
        }
        suffix = f"?{urlencode(params)}" if params else ""
        _print(client.request("GET", f"/v1/artifacts{suffix}"))
    elif args.artifact_show:
        artifact = client.request(
            "GET", f"/v1/artifacts/{quote(args.artifact_show)}"
        )["data"]
        if args.artifact_version:
            artifact["versions"] = [
                version
                for version in artifact["versions"]
                if version["version"] == args.artifact_version
            ]
        _print(artifact)
    elif args.artifact_create:
        _print(
            client.request(
                "POST",
                "/v1/artifacts",
                {
                    "name": args.artifact_create,
                    "prompt": args.prompt,
                    "artifact_type": args.artifact_type,
                    "language": args.artifact_lang,
                    "tags": [
                        tag.strip()
                        for tag in args.artifact_tags.split(",")
                        if tag.strip()
                    ],
                    "project_id": args.artifact_project or None,
                    "model": args.model,
                },
            )["data"]
        )
    elif args.artifact_iterate:
        _print(
            client.request(
                "POST",
                f"/v1/artifacts/{quote(args.artifact_iterate)}/versions",
                {"feedback": args.prompt or "", "model": args.model},
            )["data"]
        )
    elif args.artifact_diff:
        query = urlencode(
            {"from_version": args.v1, "to_version": args.v2}
        )
        _print(
            client.request(
                "GET", f"/v1/artifacts/{quote(args.artifact_diff)}/diff?{query}"
            )["data"]
        )
    elif args.artifact_delete:
        client.request("DELETE", f"/v1/artifacts/{quote(args.artifact_delete)}")
        print("Deleted.")
    elif args.artifact_tag or args.artifact_attach:
        artifact_id = args.artifact_tag or args.artifact_attach
        artifact = client.request(
            "GET", f"/v1/artifacts/{quote(artifact_id)}"
        )["data"]
        patch: dict[str, object] = {}
        if args.artifact_tag:
            patch["tags"] = sorted(set([*artifact.get("tags", []), args.tag]))
        if args.artifact_attach:
            patch["project_id"] = args.to_project
        _print(
            client.request(
                "PATCH", f"/v1/artifacts/{quote(artifact_id)}", patch
            )["data"]
        )
    elif args.artifact_export:
        artifact = client.request(
            "GET", f"/v1/artifacts/{quote(args.artifact_export)}"
        )["data"]
        version = args.artifact_version or artifact["current_version"]
        selected = next(
            item for item in artifact["versions"] if item["version"] == version
        )
        output = args.output or f"{artifact['name']}"
        Path(output).write_text(selected["content"], encoding="utf-8")
        print(output)
    elif args.artifact_export_all:
        query = urlencode({"project_id": args.artifact_export_all, "limit": 200})
        artifacts = client.request("GET", f"/v1/artifacts?{query}")["data"]
        output_dir = Path(
            args.artifact_output_dir or f"artifacts_{args.artifact_export_all}"
        )
        output_dir.mkdir(parents=True, exist_ok=True)
        for artifact in artifacts:
            content = artifact["versions"][-1]["content"]
            (output_dir / Path(artifact["name"]).name).write_text(
                content, encoding="utf-8"
            )
        print(output_dir)
    elif args.research:
        report = client.request(
            "POST",
            "/v1/research-reports",
            {
                "topic": args.research,
                "depth": args.research_depth,
                "source_urls": args.research_urls or [],
                "model": args.model,
            },
        )["data"]
        if args.output:
            Path(args.output).write_text(report["report"], encoding="utf-8")
        else:
            print(report["report"])
    elif args.file_upload:
        _print(client.upload_file(args.file_upload)["data"])
    elif args.file_list:
        _print(client.request("GET", "/v1/files"))
    elif args.file_delete:
        client.request("DELETE", f"/v1/files/{quote(args.file_delete)}")
        print("Deleted.")
    elif args.file_ask:
        _print(
            client.request(
                "POST",
                f"/v1/files/{quote(args.file_ask)}/questions",
                {"prompt": args.prompt or "Summarise.", "model": args.model},
            )["data"]
        )
    elif args.file_download:
        output = args.file_output or args.output or f"{args.file_download}.bin"
        print(client.download_file(args.file_download, output))
    elif args.agent_managed_run:
        rubric = (
            Path(args.agent_outcome_rubric).read_text(encoding="utf-8")
            if args.agent_outcome_rubric
            else None
        )
        if args.agent_outcome_rubric_file:
            raise EnterpriseAPIError(
                "--agent-outcome-rubric-file is a legacy provider file ID; "
                "use --agent-outcome-rubric with a local rubric"
            )
        system_override = args.agent_override_system or None
        override_model = args.agent_override_model or args.model
        if args.agent_override_json:
            overrides = json.loads(
                Path(args.agent_override_json).read_text(encoding="utf-8")
            )
            if not isinstance(overrides, dict):
                raise EnterpriseAPIError("--agent-override-json must contain an object")
            system_override = overrides.get("system", system_override)
            override_model = overrides.get("model", override_model)
        _print(
            client.request(
                "POST",
                "/v1/managed-agent-runs",
                {
                    "task": args.agent_managed_run,
                    "model": override_model,
                    "agent": args.agent or "full_stack",
                    "memory_store_id": args.agent_memory_store or None,
                    "vault_id": args.agent_vault or None,
                    "system": system_override,
                    "outcome_description": args.agent_outcome or None,
                    "outcome_rubric": rubric,
                    "outcome_max_iterations": args.agent_outcome_max_iter,
                },
            )["data"]
        )
    elif args.agent_memory_stores_list:
        suffix = (
            "?include_archived=true"
            if args.agent_memory_stores_include_archived
            else ""
        )
        _print(client.request("GET", f"/v1/memory-stores{suffix}"))
    elif args.agent_memory_store_create:
        if not args.agent_memory_store:
            raise EnterpriseAPIError("--agent-memory-store is required")
        _print(
            client.request(
                "POST",
                "/v1/memory-stores",
                {"name": args.agent_memory_store},
            )["data"]
        )
    elif args.agent_memory_store_archive:
        _print(
            client.request(
                "POST",
                f"/v1/memory-stores/{quote(args.agent_memory_store_archive)}/archive",
                {},
            )["data"]
        )
    elif args.agent_memory_store_delete:
        client.request(
            "DELETE",
            f"/v1/memory-stores/{quote(args.agent_memory_store_delete)}",
        )
        print("Deleted.")
    elif args.agent_memory_list:
        query = urlencode(
            {
                key: value
                for key, value in {
                    "path_prefix": args.agent_memory_path_prefix or None,
                    "depth": args.agent_memory_depth or None,
                }.items()
                if value is not None
            }
        )
        suffix = f"?{query}" if query else ""
        _print(
            client.request(
                "GET",
                f"/v1/memory-stores/{quote(args.agent_memory_list)}/memories{suffix}",
            )
        )
    elif args.agent_memory_get:
        if not args.agent_memory_id:
            raise EnterpriseAPIError("--agent-memory-id is required")
        _print(
            client.request(
                "GET",
                f"/v1/memory-stores/{quote(args.agent_memory_get)}/memories/"
                f"{quote(args.agent_memory_id)}",
            )["data"]
        )
    elif args.agent_memory_create:
        _print(
            client.request(
                "POST",
                f"/v1/memory-stores/{quote(args.agent_memory_create)}/memories",
                {
                    "path": args.agent_memory_path,
                    "content": args.agent_memory_content,
                },
            )["data"]
        )
    elif args.agent_memory_update:
        if not args.agent_memory_id:
            raise EnterpriseAPIError("--agent-memory-id is required")
        _print(
            client.request(
                "PATCH",
                f"/v1/memory-stores/{quote(args.agent_memory_update)}/memories/"
                f"{quote(args.agent_memory_id)}",
                {
                    key: value
                    for key, value in {
                        "path": args.agent_memory_path or None,
                        "content": args.agent_memory_content or None,
                    }.items()
                    if value is not None
                },
            )["data"]
        )
    elif args.agent_memory_delete:
        if not args.agent_memory_id:
            raise EnterpriseAPIError("--agent-memory-id is required")
        client.request(
            "DELETE",
            f"/v1/memory-stores/{quote(args.agent_memory_delete)}/memories/"
            f"{quote(args.agent_memory_id)}",
        )
        print("Deleted.")
    elif args.agent_dream:
        _print(
            client.request(
                "POST",
                "/v1/agent-dreams",
                {
                    "memory_store_id": args.agent_dream,
                    "session_ids": [
                        value.strip()
                        for value in args.agent_dream_sessions.split(",")
                        if value.strip()
                    ],
                    "instructions": args.agent_dream_instructions or None,
                    "model": args.model,
                },
            )["data"]
        )
    elif args.agent_dream_get:
        _print(
            client.request(
                "GET", f"/v1/agent-dreams/{quote(args.agent_dream_get)}"
            )["data"]
        )
    elif args.agent_dream_list:
        _print(client.request("GET", "/v1/agent-dreams"))
    elif args.agent_webhook_register:
        _print(
            client.request(
                "POST",
                "/v1/agent-webhooks",
                {
                    "url": args.agent_webhook_register,
                    "event_types": [
                        value.strip()
                        for value in args.agent_webhook_events.split(",")
                        if value.strip()
                    ],
                },
            )["data"]
        )
    elif args.agent_vault_create:
        _print(
            client.request(
                "POST",
                "/v1/agent-vaults",
                {
                    "display_name": args.agent_vault_create,
                    "external_user_id": args.agent_vault_external_user or None,
                },
            )["data"]
        )
    elif args.agent_vault_add_credential:
        if not args.agent_vault_cred_type:
            raise EnterpriseAPIError("--agent-vault-cred-type is required")
        _print(
            client.request(
                "POST",
                f"/v1/agent-vaults/{quote(args.agent_vault_add_credential)}/credentials",
                {
                    "credential_type": args.agent_vault_cred_type,
                    "secret_value": args.agent_vault_secret,
                    "mcp_server_url": args.agent_vault_mcp_url or None,
                    "secret_name": args.agent_vault_secret_name or None,
                    "allowed_domains": [
                        value.strip()
                        for value in args.agent_vault_allowed_domains.split(",")
                        if value.strip()
                    ],
                    "injection_location": (
                        args.agent_vault_injection_location or None
                    ),
                },
            )["data"]
        )
    elif args.agent_vault_list:
        _print(client.request("GET", "/v1/agent-vaults"))
    elif args.agent_schedule_create:
        _print(
            client.request(
                "POST",
                "/v1/agent-schedules",
                {
                    "agent_id": args.agent_schedule_create,
                    "environment_id": args.agent_schedule_env,
                    "cron_expression": args.agent_schedule_cron,
                    "timezone": args.agent_schedule_tz,
                    "task": args.agent_schedule_task,
                },
            )["data"]
        )
    elif args.agent_schedule_list:
        _print(client.request("GET", "/v1/agent-schedules"))
    elif args.agent_schedule_cancel:
        _print(
            client.request(
                "POST",
                f"/v1/agent-schedules/{quote(args.agent_schedule_cancel)}/cancel",
                {},
            )["data"]
        )
    elif args.agent_review_multiagent:
        uploaded = client.upload_file(args.agent_review_multiagent)["data"]
        _print(
            client.request(
                "POST",
                "/v1/multi-agent-reviews",
                {
                    "file_id": uploaded["id"],
                    "specialists": [
                        value.strip()
                        for value in args.agent_review_specialists.split(",")
                        if value.strip()
                    ],
                    "model": args.model,
                },
            )["data"]
        )
    elif args.agent_outcome_rubric_upload:
        _print(client.upload_file(args.agent_outcome_rubric_upload)["data"])
    elif args.agent_env_self_hosted:
        _print(
            client.request(
                "POST",
                "/v1/agent-environments",
                {"name": args.agent_env_self_hosted},
            )["data"]
        )
    elif args.agent_env_work_stats:
        _print(
            client.request(
                "GET",
                f"/v1/agent-environments/{quote(args.agent_env_work_stats)}/work-stats",
            )["data"]
        )
    else:
        return False
    return True


__all__ = ["dispatch_enterprise_resource_command"]
