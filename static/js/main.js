let currentCategory = null;
let currentPage = 1;
let totalPages = 1;
let logFields = [];
let eventSource = null;
let currentSearchTerm = '';

document.addEventListener('DOMContentLoaded', function() {
    fetchCategories();
    
    document.getElementById('prev-page').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            fetchLogs(currentCategory, currentPage, currentSearchTerm);
        }
    });
    
    document.getElementById('next-page').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            fetchLogs(currentCategory, currentPage, currentSearchTerm);
        }
    });
    
    document.getElementById('go-page').addEventListener('click', () => {
        const pageInput = document.getElementById('page-input');
        const page = parseInt(pageInput.value);
        if (page >= 1 && page <= totalPages) {
            currentPage = page;
            fetchLogs(currentCategory, currentPage, currentSearchTerm);
        } else {
            alert(`Please enter a page number between 1 and ${totalPages}`);
        }
    });
    
    document.getElementById('search-input').addEventListener('input', debounce(function() {
        const searchTerm = this.value.trim();
        if (searchTerm.length > 2 || searchTerm.length === 0) {
            currentPage = 1;
            
            currentSearchTerm = searchTerm;
            
            fetchLogs(currentCategory, currentPage, searchTerm);
        }
    }, 500));
    
    document.getElementById('search-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            const searchTerm = this.value.trim();
            currentPage = 1;
            currentSearchTerm = searchTerm;
            fetchLogs(currentCategory, currentPage, searchTerm);
        }
    });
    
    document.getElementById('clear-search').addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        currentSearchTerm = '';
        currentPage = 1;
        fetchLogs(currentCategory, currentPage, '');
    });
});

async function fetchCategories() {
    try {
        const response = await fetch('/api/categories');
        const data = await response.json();
        
        const categoriesList = document.getElementById('categories-list');
        categoriesList.innerHTML = '';
        
        data.categories.forEach(category => {
            const item = document.createElement('a');
            item.className = 'list-group-item list-group-item-action';
            item.textContent = formatCategoryName(category);
            item.dataset.category = category;
            
            item.addEventListener('click', () => {
                document.querySelectorAll('#categories-list a').forEach(el => {
                    el.classList.remove('active');
                });
                item.classList.add('active');
                
                currentCategory = category;
                currentPage = 1;
                currentSearchTerm = '';
                
                document.getElementById('search-input').value = '';
                
                fetchLogs(category, currentPage, '');
                
                setupRealTimeUpdates(category);
            });
            
            categoriesList.appendChild(item);
        });
        
        if (data.categories.length > 0) {
            categoriesList.firstChild.click();
        }
    } catch (error) {
        console.error('Error fetching categories:', error);
    }
}

function formatCategoryName(category) {
    return category
        .replace('_', ' ')
        .replace(/-/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

async function fetchLogs(category, page, searchTerm = '') {
    try {
        await fetchSchema(category);
        
        let url = `/api/logs/${category}?page=${page}&limit=15`;
        if (searchTerm) {
            url += `&search=${encodeURIComponent(searchTerm)}`;
        }
        
        const response = await fetch(url);
        const data = await response.json();
        
        updateLogsTable(data.logs);
        
        totalPages = data.pages;
        document.getElementById('pagination-info').textContent = `Page ${data.page} of ${data.pages} (${data.total} logs)`;
        
        currentSearchTerm = searchTerm;
    } catch (error) {
        console.error('Error fetching logs:', error);
    }
}

async function fetchSchema(category) {
    try {
        const response = await fetch(`/api/schema/${category}`);
        const data = await response.json();
        
        logFields = data.fields.filter(field => 
            !field.match(/^\d+$/) && 
            field !== "_id"     
        );
        
        if (category === "cpu_usage") {
            const numericFields = data.fields.filter(field => field.match(/^\d+$/));
            const maxNumericField = numericFields.length > 0 
                ? Math.max(...numericFields.map(f => parseInt(f))) 
                : 9;
            
            for (let i = 0; i <= maxNumericField; i++) {
                if (!logFields.includes(i.toString())) {
                    logFields.push(i.toString());
                }
            }
        }
        
        const headers = document.getElementById('log-headers');
        headers.innerHTML = '<tr></tr>';
        
        logFields.forEach(field => {
            const th = document.createElement('th');
            th.textContent = formatFieldName(field);
            headers.firstChild.appendChild(th);
        });
    } catch (error) {
        console.error('Error fetching schema:', error);
    }
}

function formatFieldName(field) {
    if (field.match(/^\d+$/)) {
        return field;
    }
    
    if (field === "cpu_usage_data") {
        return "CPU Usage";
    }
    
    return field
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function updateLogsTable(logs) {
    const logData = document.getElementById('log-data');
    logData.innerHTML = '';
    
    logs.forEach(log => {
        const row = document.createElement('tr');
        row.className = 'log-row';
        row.dataset.id = log._id;
        
        const isCpuUsage = log.type === "cpu_usage" || log.type === "cpu_usage";
        
        logFields.forEach(field => {
            const td = document.createElement('td');
            
            let value = log[field];
            
            if (isCpuUsage && field.match(/^\d+$/)) {
                if (value) {
                    try {
                        let processInfo;
                        if (typeof value === 'string') {
                            try {
                                processInfo = JSON.parse(value.replace(/'/g, '"'));
                            } catch (e) {
                                processInfo = value;
                            }
                        } else {
                            processInfo = value;
                        }
                        
                        if (typeof processInfo === 'object' && processInfo !== null) {
                            const pid = processInfo.pid || 'N/A';
                            const comm = processInfo.comm || 'N/A';
                            const usage = typeof processInfo.cpu_usage === 'number' 
                                ? processInfo.cpu_usage.toFixed(2) + '%' 
                                : (processInfo.cpu_usage || 'N/A');
                            
                            td.textContent = `{"pid":${pid},"comm":"${comm}","cpu_usage":${usage}}`;
                        } else {
                            td.textContent = value;
                        }
                    } catch (error) {
                        console.error('Error formatting process info:', error);
                        td.textContent = value;
                    }
                } else {
                    td.textContent = '';
                }
                row.appendChild(td);
                return;
            }
            
            if (field === 'timestamp' && typeof value === 'number') {
                value = formatTimestamp(value);
            }
            
            if (typeof value === 'object' && value !== null) {
                value = JSON.stringify(value).substring(0, 50) + '...';
            }
            
            td.textContent = value === undefined ? '' : value;
            row.appendChild(td);
        });
        
        row.addEventListener('click', () => {
            showLogDetails(log._id);
        });
        
        logData.appendChild(row);
    });
}

function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
}

async function showLogDetails(logId) {
    try {
        const response = await fetch(`/api/logs/${currentCategory}/${logId}`);
        const log = await response.json();
        
        const detailContent = document.getElementById('log-detail-content');
        detailContent.innerHTML = '';
        
        const pre = document.createElement('pre');
        pre.innerHTML = formatJSON(log);
        detailContent.appendChild(pre);
        
        const modal = new bootstrap.Modal(document.getElementById('logDetailModal'));
        modal.show();
    } catch (error) {
        console.error('Error fetching log details:', error);
    }
}

function formatJSON(obj) {
    return JSON.stringify(obj, null, 2)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/("(\u[a-zA-Z0-9]{4}|\[^u]|[^\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function(match) {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
}

function filterLogs(searchTerm) {
    const rows = document.querySelectorAll('#log-data tr');
    const lowerSearchTerm = searchTerm.toLowerCase();
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(lowerSearchTerm)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

function debounce(func, wait) {
    let timeout;
    return function() {
        const context = this;
        const args = arguments;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(context, args);
        }, wait);
    };
}

function setupRealTimeUpdates(category) {
    fetch('/stream?category=' + category)
        .then(response => response.json())
        .then(data => {
            if (data.message && data.message.includes('disabled')) {
                console.log('Real-time updates are disabled');
                return;
            }
            
            setupSSEConnection(category);
        })
        .catch(error => {
            console.error('Error checking real-time status:', error);
        });
}

function setupSSEConnection(category) {
    if (eventSource) {
        eventSource.close();
    }
    
    eventSource = new EventSource(`/stream?category=${category}`);
    
    eventSource.addEventListener('new_logs', event => {
        const data = JSON.parse(event.data);
        
        if (data[category] && data[category].length > 0) {
            if (currentPage === 1) {
                const newLogs = data[category];
                
                const currentLogs = Array.from(document.querySelectorAll('#log-data tr')).map(row => row.dataset.id);
                
                const uniqueNewLogs = newLogs.filter(log => !currentLogs.includes(log._id));
                
                if (uniqueNewLogs.length > 0) {
                    fetchLogs(category, currentPage, currentSearchTerm);
                }
            }
        }
    });
    
    eventSource.onerror = error => {
        console.error('SSE Error:', error);
        eventSource.close();
        
        setTimeout(() => {
            setupRealTimeUpdates(category);
        }, 5000);
    };
}
        