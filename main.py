from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from typing import Optional 
from pymongo import MongoClient
from pymongo.server_api import ServerApi
import json
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from sse_starlette.sse import EventSourceResponse
from bson import ObjectId
import logging
import uvicorn

ENABLE_REAL_TIME_UPDATES = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Log Monitoring Dashboard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

uri = "mongodb+srv://royoswaldha:<password>@log.ffkxi.mongodb.net/?retryWrites=true&w=majority&appName=log"
db_client = MongoClient(uri, server_api=ServerApi('1'))
db = db_client["log"]
cpu_usage_log_collection = db["cpu_usage_log"]
file_log_collection = db["file_log"]
process_log_collection = db["process_log"]
network_log_collection = db["network_log"]

collections = {
    "log-process": process_log_collection,
    "file_operation": file_log_collection,
    "cpu_usage": cpu_usage_log_collection,
    "network": network_log_collection
}

app.mount("/static", StaticFiles(directory="static"), name="static")

templates = Jinja2Templates(directory="templates")

class JSONEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, ObjectId):
            return str(o)
        return super().default(o)

def get_collection_fields(collection):
    sample = collection.find_one()
    if not sample:
        return []
    return [field for field in sample.keys() if field != '_id']

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(
        "index.html", 
        {"request": request, "categories": list(collections.keys())}
    )

@app.get("/api/categories")
async def get_categories():
    return {"categories": list(collections.keys())}

@app.get("/api/logs/{category}")
async def get_logs(
    category: str, 
    page: int = Query(1, ge=1), 
    limit: int = Query(15, ge=1, le=100),
    search: Optional[str] = None
):
    if category not in collections:
        raise HTTPException(status_code=404, detail=f"Category {category} not found")
    
    collection = collections[category]
    
    filter_query = {}
    if search and search.strip():
        fields = get_collection_fields(collection)
        
        or_conditions = []
        for field in fields:
            or_conditions.append({field: {"$regex": search, "$options": "i"}})
        
        if or_conditions:
            filter_query = {"$or": or_conditions}
    
    total = collection.count_documents(filter_query)
    
    skip = (page - 1) * limit
    
    cursor = collection.find(filter_query).sort("timestamp", -1).skip(skip).limit(limit)
    logs = list(cursor)
    
    if category == "cpu_usage":
        for log in logs:
            numeric_columns = {}
            for key, value in list(log.items()):
                if key.isdigit() or (isinstance(key, int) or key.isdigit()):
                    try:
                        if isinstance(value, str):
                            try:
                                parsed_value = json.loads(value.replace("'", "\""))
                                numeric_columns[key] = parsed_value
                            except json.JSONDecodeError:
                                numeric_columns[key] = value
                        else:
                            numeric_columns[key] = value
                        
                        if key in log:
                            del log[key]
                    except Exception as e:
                        logger.error(f"Error processing column {key}: {e}")
            
            for i in range(10):
                col_key = str(i)
                if col_key in numeric_columns:
                    log[col_key] = numeric_columns[col_key]
    
    logs_json = json.loads(json.dumps(logs, cls=JSONEncoder))
    
    return {
        "logs": logs_json,
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit
    }

@app.get("/api/logs/{category}/{log_id}")
async def get_log_detail(category: str, log_id: str):
    if category not in collections:
        raise HTTPException(status_code=404, detail=f"Category {category} not found")
    
    collection = collections[category]
    log = collection.find_one({"_id": ObjectId(log_id)})
    
    if not log:
        raise HTTPException(status_code=404, detail=f"Log with ID {log_id} not found")
    
    log_json = json.loads(json.dumps(log, cls=JSONEncoder))
    
    return log_json

@app.get("/api/schema/{category}")
async def get_schema(category: str):
    if category not in collections:
        raise HTTPException(status_code=404, detail=f"Category {category} not found")
    
    collection = collections[category]
    fields = get_collection_fields(collection)
    
    return {"fields": fields}

@app.get("/stream")
async def stream(request: Request, category: Optional[str] = None):
    if not ENABLE_REAL_TIME_UPDATES:
        return {"message": "Real-time disabled"}
    return EventSourceResponse(event_generator(request, category))

async def event_generator(request: Request, category: Optional[str] = None):
    last_ids = {cat: None for cat in collections.keys()}
    
    try:
        while True:
            if await request.is_disconnected():
                break
            
            new_logs = {}

            for cat_name, collection in collections.items():
                if category and cat_name != category:
                    continue
                
                filter_query = {}
                if last_ids[cat_name]:
                    filter_query["_id"] = {"$gt": ObjectId(last_ids[cat_name])}
                
                cursor = collection.find(filter_query).sort("_id", 1).limit(10)
                logs = list(cursor)
                
                if logs:
                    last_ids[cat_name] = str(logs[-1]["_id"])
                    new_logs[cat_name] = json.loads(json.dumps(logs, cls=JSONEncoder))
            
            if new_logs:
                yield {
                    "event": "new_logs",
                    "data": json.dumps(new_logs)
                }
            
            await asyncio.sleep(2)
    except Exception as e:
        logger.error(f"Error in event generator: {e}")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)