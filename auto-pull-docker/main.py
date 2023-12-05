import docker
import time
import logging
from logging.handlers import RotatingFileHandler
from telegram import Bot
import requests

TELEGRAM_BOT_TOKEN = ''
TELEGRAM_CHAT_ID = ''

def send_telegram_message(message):
    bot = Bot(token=TELEGRAM_BOT_TOKEN)
    bot.send_message(chat_id=TELEGRAM_CHAT_ID, text=message, parse_mode='HTML')

log_formatter = logging.Formatter('%(asctime)s - %(levelname)s: %(message)s')
log_handler = RotatingFileHandler('logs.log', maxBytes=1024 * 1024, backupCount=5)
log_handler.setFormatter(log_formatter)
logger = logging.getLogger()
logger.addHandler(log_handler)
logger.setLevel(logging.INFO)

def get_image_info(image_name):
    try:
        response = requests.get(f"https://hub.docker.com/v2/repositories/{image_name}/tags/latest")
        if response.status_code == 200:
            image_info = response.json()
            return image_info
        else:
            print(f"Failed to get image info, status code: {response.status_code}")
            return None
    except requests.RequestException as e:
        print(f"Request error: {e}")
        return None

def check_and_update_image(container_name, image_name):
    client = docker.from_env()

    logger.info(f"Start pull image..")

    try:
        version = get_image_info(image_name)
        digest = image_name + '@' + version['digest']
        
        container = client.containers.get(container_name)
        current_image_id = container.image.id
        current_image_digest = container.image.attrs['RepoDigests'][0] if 'RepoDigests' in container.image.attrs else None

        logger.info(f"current_image_id {current_image_id}")
        logger.info(f"current_image_digest {current_image_digest}")
        logger.info(f"digest {digest}")

        if current_image_digest != digest:
            logger.info("Updating...")
            send_telegram_message("🚀 <b>Auto Pull Docker - Raspberry pi</b> Deployment has started!")
            client.images.pull(image_name)
            container.stop()
            container.remove()

            client.containers.run(image_name, detach=True, name=container_name, volumes={
                '/home/dongtran/py/.env': {'bind': '/usr/src/app/.env', 'mode': 'rw'}
            })
            logger.info("Container update successful.")
            send_telegram_message("🚀 <b>Auto Pull Docker - Raspberry pi</b> Deployment on raspberry pi sucessful!")
        else:
            logger.info("No action.")
    except docker.errors.NotFound as e:
        logger.error(f"Container '{container_name}' not found: {e}")
        return
    except docker.errors.APIError as e:
        logger.error(f"APIError: {e}")
        return
    except docker.errors.ImageNotFound:
        logger.error(f"Image '{image_name}' not exist")
        return

if __name__ == "__main__":
    container_name = ""
    image_name = ""

    while True:
        check_and_update_image(container_name, image_name)
        time.sleep(30)
