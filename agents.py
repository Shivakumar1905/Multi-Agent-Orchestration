import os
from dotenv import load_dotenv
from typing import TypedDict, AsyncGenerator, Any
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

load_dotenv()


llm = ChatOpenAI(
    model="gpt-4o-mini",
    openai_api_key=os.getenv("OPENAI_API_KEY", ""),
    max_tokens=4096,
)


class AgentState(TypedDict):
    code: str
    language: str
    errors: str
    explanation: str
    fixed_code: str


def detector_node(state: AgentState) -> AgentState:
    messages = [
        SystemMessage(content=(
            "You are a senior code reviewer and bug detector. "
            "Your only job is to find ALL errors, bugs, anti-patterns, and issues in the provided code. "
            "Be specific: mention line numbers or code snippets where possible. "
            "List every issue found. If there are no errors, say 'No errors found.' "
            "Do NOT fix anything. Do NOT explain in depth. Just list the problems concisely."
        )),
        HumanMessage(content=(
            f"Language: {state['language']}\n\n"
            f"Code:\n```\n{state['code']}\n```\n\n"
            "List all errors and issues found in this code."
        )),
    ]
    response = llm.invoke(messages)
    return {**state, "errors": response.content}


def explainer_node(state: AgentState) -> AgentState:
    messages = [
        SystemMessage(content=(
            "You are a patient and thorough programming tutor. "
            "Given a piece of code and its detected errors, provide a clear, detailed explanation "
            "of why each error occurs, what concept is being violated, and what the impact is. "
            "Use plain English. Structure your response with numbered points. "
            "Help the user understand the root cause, not just the symptom."
        )),
        HumanMessage(content=(
            f"Language: {state['language']}\n\n"
            f"Original Code:\n```\n{state['code']}\n```\n\n"
            f"Detected Errors:\n{state['errors']}\n\n"
            "Explain each error in detail so the developer can learn from it."
        )),
    ]
    response = llm.invoke(messages)
    return {**state, "explanation": response.content}


def fixer_node(state: AgentState) -> AgentState:
    messages = [
        SystemMessage(content=(
            "You are an expert software engineer. "
            "Given buggy code and its known errors, produce a fully corrected version. "
            "Rules:\n"
            "1. Fix ALL identified errors.\n"
            "2. Preserve the original intent and structure as much as possible.\n"
            "3. Add brief inline comments ONLY where a fix was applied, prefixed with '# FIXED:'.\n"
            "4. Return ONLY the corrected code block — no prose before or after it.\n"
            "5. Wrap the code in triple backticks with the language tag."
        )),
        HumanMessage(content=(
            f"Language: {state['language']}\n\n"
            f"Buggy Code:\n```\n{state['code']}\n```\n\n"
            f"Errors to fix:\n{state['errors']}\n\n"
            "Return the fully corrected code."
        )),
    ]
    response = llm.invoke(messages)
    return {**state, "fixed_code": response.content}


def build_graph() -> StateGraph:
    graph = StateGraph(AgentState)
    graph.add_node("detector", detector_node)
    graph.add_node("explainer", explainer_node)
    graph.add_node("fixer", fixer_node)

    graph.set_entry_point("detector")
    graph.add_edge("detector", "explainer")
    graph.add_edge("explainer", "fixer")
    graph.add_edge("fixer", END)

    return graph.compile()


compiled_graph = build_graph()


async def run_pipeline(code: str, language: str) -> AsyncGenerator[dict, None]:
    initial_state: AgentState = {
        "code": code,
        "language": language,
        "errors": "",
        "explanation": "",
        "fixed_code": "",
    }

    yield {"stage": "detector", "status": "running", "content": ""}

    state = detector_node(initial_state)
    yield {"stage": "detector", "status": "done", "content": state["errors"]}

    yield {"stage": "explainer", "status": "running", "content": ""}

    state = explainer_node(state)
    yield {"stage": "explainer", "status": "done", "content": state["explanation"]}

    yield {"stage": "fixer", "status": "running", "content": ""}

    state = fixer_node(state)
    yield {"stage": "fixer", "status": "done", "content": state["fixed_code"]}