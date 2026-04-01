"""
GET /api/v1/agents               — list all registered agents
GET /api/v1/agents/{name}/health — last known HealthReport for an agent
GET /api/v1/agents/{name}/gap    — last known GapReport for an agent
GET /api/v1/agents/{name}/proof  — last known proof records for an agent
GET /api/v1/agents/{name}/usage  — last known token usage for an agent

All endpoints require the X-Admin-Key header (verify_admin_key dependency).
The {name} path parameter is validated against the k8s resource name pattern.
"""
from __future__ import annotations

import logging
from typing import Any, Optional, Type

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from auth.keys import verify_admin_key
from db.base import get_session
from db.models import Agent, Heartbeat
from schemas import AgentSummary, StoredHealthReport, StoredGapReport, StoredProofRecords, StoredUsageReport

logger = logging.getLogger(__name__)
router = APIRouter()

# k8s resource name pattern (RFC 1123 DNS label)
_K8S_NAME_PATH = Path(
    ...,
    min_length=1,
    max_length=63,
    pattern=r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
    description="Kubernetes-safe agent name (lowercase alphanumeric + hyphens)",
)


async def _get_latest_heartbeat(
    name: str, session: AsyncSession
) -> tuple[Agent, Heartbeat]:
    """Return agent + its most recent heartbeat, raising 404 if either is absent."""
    result = await session.execute(select(Agent).where(Agent.name == name))
    agent = result.scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")

    hb_result = await session.execute(
        select(Heartbeat)
        .where(Heartbeat.agent_id == agent.id)
        .order_by(Heartbeat.received_at.desc())
        .limit(1)
    )
    latest = hb_result.scalar_one_or_none()
    if latest is None:
        raise HTTPException(
            status_code=404, detail=f"No heartbeat received yet for '{name}'"
        )
    return agent, latest


async def _get_validated_field(
    name: str,
    session: AsyncSession,
    field: str,
    schema: Type[BaseModel],
    raw_data: Optional[dict[str, Any]] = None,
) -> dict:
    """Fetch a field from the latest heartbeat, validate through a Pydantic model, return dict.

    When raw_data is provided it is used instead of getattr(latest, field).
    This handles the common pattern of merging extra fields (e.g. receivedAt) before validation.
    """
    _, latest = await _get_latest_heartbeat(name, session)
    data = raw_data if raw_data is not None else getattr(latest, field, None)
    if data is None:
        data = {"receivedAt": latest.received_at.isoformat()}
    else:
        data = {**data, "receivedAt": latest.received_at.isoformat()}
    try:
        report = schema.model_validate(data)
    except Exception:
        logger.error("Stored %s data for '%s' failed schema validation", field, name)
        raise HTTPException(status_code=500, detail=f"Stored {field} data is corrupt")
    return report.model_dump()


@router.get(
    "/agents",
    response_model=list[AgentSummary],
    dependencies=[Depends(verify_admin_key)],
)
async def list_agents(
    session: AsyncSession = Depends(get_session),
) -> list[AgentSummary]:
    result = await session.execute(select(Agent).order_by(Agent.created_at))
    agents = result.scalars().all()
    return [
        AgentSummary(
            agentId=a.id,
            agentName=a.name,
            runtime=a.runtime,
            phase=a.phase,
            grade=a.grade,
            score=a.score,
            lastSeen=a.last_seen,
        )
        for a in agents
    ]


@router.get(
    "/agents/{name}/health",
    dependencies=[Depends(verify_admin_key)],
)
async def get_agent_health(
    name: str = _K8S_NAME_PATH,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return the last known HealthReport for a remote agent."""
    _, latest = await _get_latest_heartbeat(name, session)
    try:
        report = StoredHealthReport.model_validate(latest.health)
    except Exception:
        logger.error("Stored health data for '%s' failed schema validation", name)
        raise HTTPException(status_code=500, detail="Stored health data is corrupt")
    return report.model_dump()


@router.get(
    "/agents/{name}/gap",
    dependencies=[Depends(verify_admin_key)],
)
async def get_agent_gap(
    name: str = _K8S_NAME_PATH,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return the last known GapReport for a remote agent (from its latest heartbeat)."""
    return await _get_validated_field(name, session, "gap", StoredGapReport)


@router.get(
    "/agents/{name}/proof",
    dependencies=[Depends(verify_admin_key)],
)
async def get_agent_proof(
    name: str = _K8S_NAME_PATH,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return the last known proof records for a remote agent (from its latest heartbeat)."""
    _, latest = await _get_latest_heartbeat(name, session)
    return await _get_validated_field(
        name, session, "proof", StoredProofRecords,
        raw_data={"records": latest.proof or []},
    )


@router.get(
    "/agents/{name}/usage",
    dependencies=[Depends(verify_admin_key)],
)
async def get_agent_usage(
    name: str = _K8S_NAME_PATH,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Return the last known token usage for a remote agent (from its latest heartbeat)."""
    return await _get_validated_field(name, session, "usage", StoredUsageReport)
