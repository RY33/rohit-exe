
import logging
import sys

def configure_logging():
    """
    Configure logging for Vercel/serverless deployment.
    Logs are sent to stdout/stderr instead of local files.
    """

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True
    )

    return logging.getLogger(__name__)
