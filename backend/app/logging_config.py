import atexit
import logging
import logging.handlers
import queue
import time

from app.config import VOICE_LOG_DIRECTORY, VOICE_LOG_LEVEL


class UtcMillisecondsFormatter(logging.Formatter):
    converter = time.gmtime


_listener: logging.handlers.QueueListener | None = None


def configure_logging() -> None:
    global _listener

    logger = logging.getLogger("rohit_voice")
    if _listener is not None:
        return

    VOICE_LOG_DIRECTORY.mkdir(parents=True, exist_ok=True)
    formatter = UtcMillisecondsFormatter(
        "%(asctime)s.%(msecs)03dZ %(levelname)s [%(category)s] "
        "[session=%(session_id)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    file_handler = logging.handlers.RotatingFileHandler(
        VOICE_LOG_DIRECTORY / "voice-ai.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    console_handler = logging.StreamHandler()
    for handler in (file_handler, console_handler):
        handler.setLevel(VOICE_LOG_LEVEL)
        handler.setFormatter(formatter)

    log_queue: queue.Queue[logging.LogRecord] = queue.Queue(-1)
    queue_handler = logging.handlers.QueueHandler(log_queue)
    queue_handler.setLevel(VOICE_LOG_LEVEL)
    logger.setLevel(VOICE_LOG_LEVEL)
    logger.addHandler(queue_handler)
    logger.propagate = False

    _listener = logging.handlers.QueueListener(
        log_queue,
        file_handler,
        console_handler,
        respect_handler_level=True,
    )
    _listener.start()
    atexit.register(_listener.stop)


def log_event(
    category: str,
    session_id: str,
    message: str,
    level: int = logging.INFO,
) -> None:
    safe_message = "".join(
        character if character >= " " or character == "\t" else " "
        for character in message
    )
    safe_category = "".join(
        character if character.isalnum() or character in "._-" else "_"
        for character in category
    )
    safe_session_id = "".join(
        character if character.isalnum() or character in "._-" else "_"
        for character in session_id
    )
    logging.getLogger("rohit_voice").log(
        level,
        safe_message[:4000],
        extra={
            "category": safe_category[:32] or "GENERAL",
            "session_id": safe_session_id[:64] or "-",
        },
    )
