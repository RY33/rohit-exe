
import logging
import sys

logger = logging.getLogger("voice_ai")


def configure_logging() -> logging.Logger:
    """Configure stdout logging for serverless deployment."""

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True,
    )

    return logger


def log_event(
    event_name: str,
    *args: object,
    **kwargs: object,
) -> None:
    """Log structured application events."""

    level = kwargs.pop("level", None)
    if level is None and args and isinstance(args[-1], int):
        level = args[-1]
        args = args[:-1]
    if level is None:
        level = logging.INFO
    if not isinstance(level, int):
        raise TypeError("Log level must be an integer.")

    logger.log(
        level,
        "%s | %s",
        event_name,
        kwargs if kwargs else " | ".join(str(argument) for argument in args),
    )
