"""
Background Task Processing Service

Provides async document processing without blocking web requests.
Uses threading for simple async execution with thread-safe operations.
"""

import threading
import queue
import time
import uuid
from typing import Dict, Any, Optional, Callable
from dataclasses import dataclass, field
from enum import Enum

MAX_RESULTS_SIZE = 1000
CLEANUP_INTERVAL = 300


class TaskStatus(Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TaskResult:
    task_id: str
    status: TaskStatus
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    completed_at: Optional[float] = None
    progress: int = 0


_task_queue: queue.Queue = queue.Queue(maxsize=100)
_results: Dict[str, TaskResult] = {}
_results_lock = threading.Lock()
_workers_started = False
_workers_lock = threading.Lock()
_worker_count = 2
_last_cleanup = time.time()


def _maybe_cleanup():
    """Periodically clean up old results"""
    global _last_cleanup
    now = time.time()
    
    if now - _last_cleanup < CLEANUP_INTERVAL:
        return
    
    _last_cleanup = now
    cleanup_old_results(max_age_seconds=3600)


def _process_task(task_id: str, func: Callable, args: tuple, kwargs: dict):
    """Process a single task"""
    with _results_lock:
        if task_id in _results:
            _results[task_id].status = TaskStatus.PROCESSING
    
    try:
        result = func(*args, **kwargs)
        with _results_lock:
            if task_id in _results:
                _results[task_id].status = TaskStatus.COMPLETED
                _results[task_id].result = result
                _results[task_id].completed_at = time.time()
    except Exception as e:
        with _results_lock:
            if task_id in _results:
                _results[task_id].status = TaskStatus.FAILED
                _results[task_id].error = str(e)
                _results[task_id].completed_at = time.time()


def _worker():
    """Background worker thread"""
    while True:
        try:
            task_id, func, args, kwargs = _task_queue.get(timeout=1)
            _maybe_cleanup()
            _process_task(task_id, func, args, kwargs)
            _task_queue.task_done()
        except queue.Empty:
            _maybe_cleanup()
            continue
        except Exception as e:
            print(f"Worker error: {e}")


def start_workers():
    """Start background worker threads"""
    global _workers_started
    
    with _workers_lock:
        if _workers_started:
            return
        
        for i in range(_worker_count):
            t = threading.Thread(target=_worker, daemon=True, name=f"bg-worker-{i}")
            t.start()
        
        _workers_started = True
        print(f"Started {_worker_count} background workers")


def submit_task(func: Callable, *args, **kwargs) -> str:
    """
    Submit a task for background processing.
    
    Returns task_id that can be used to check status.
    Raises queue.Full if the queue is at capacity.
    """
    start_workers()
    
    task_id = str(uuid.uuid4())
    
    with _results_lock:
        if len(_results) >= MAX_RESULTS_SIZE:
            cleanup_old_results(max_age_seconds=1800)
        
        _results[task_id] = TaskResult(
            task_id=task_id,
            status=TaskStatus.PENDING
        )
    
    try:
        _task_queue.put((task_id, func, args, kwargs), timeout=5)
    except queue.Full:
        with _results_lock:
            if task_id in _results:
                del _results[task_id]
        raise
    
    return task_id


def get_task_status(task_id: str) -> Optional[TaskResult]:
    """Get status of a submitted task. Thread-safe."""
    with _results_lock:
        return _results.get(task_id)


def get_task_result(task_id: str, timeout: float = 0) -> Optional[Dict[str, Any]]:
    """
    Get result of a completed task.
    
    Args:
        task_id: Task ID from submit_task
        timeout: Max seconds to wait (0 = don't wait)
    
    Returns:
        Task result dict or None if not ready/not found
    """
    start = time.time()
    
    while True:
        with _results_lock:
            task = _results.get(task_id)
        
        if not task:
            return None
        
        if task.status == TaskStatus.COMPLETED:
            return task.result
        
        if task.status == TaskStatus.FAILED:
            return {"error": task.error}
        
        if timeout <= 0 or (time.time() - start) >= timeout:
            return None
        
        time.sleep(0.1)


def cleanup_old_results(max_age_seconds: int = 3600) -> int:
    """Remove completed task results older than max_age_seconds. Thread-safe."""
    now = time.time()
    
    with _results_lock:
        to_remove = []
        for task_id, result in _results.items():
            if result.completed_at and (now - result.completed_at) > max_age_seconds:
                to_remove.append(task_id)
        
        for task_id in to_remove:
            del _results[task_id]
    
    return len(to_remove)


def get_queue_stats() -> Dict[str, Any]:
    """Get background task queue statistics. Thread-safe."""
    with _results_lock:
        pending = sum(1 for r in _results.values() if r.status == TaskStatus.PENDING)
        processing = sum(1 for r in _results.values() if r.status == TaskStatus.PROCESSING)
        completed = sum(1 for r in _results.values() if r.status == TaskStatus.COMPLETED)
        failed = sum(1 for r in _results.values() if r.status == TaskStatus.FAILED)
        total = len(_results)
    
    return {
        'queue_size': _task_queue.qsize(),
        'pending': pending,
        'processing': processing,
        'completed': completed,
        'failed': failed,
        'total_tracked': total,
        'max_tracked': MAX_RESULTS_SIZE,
        'workers': _worker_count,
        'workers_started': _workers_started
    }
