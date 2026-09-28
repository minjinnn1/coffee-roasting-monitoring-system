# Coffee Roasting Monitoring & Control System

Bachelor's capstone project focused on the design and implementation of an industrial monitoring and control system for the coffee bean roasting process.

The system provides real-time process monitoring, recipe-based roasting control, batch tracking, alarm management, historical data, and automated XLSX batch reports.

## Windows Demo

A standalone Windows demo is available and can be installed without MySQL, Node.js, or additional database configuration.

**Download:** [Coffee Roasting Monitoring System v1.0.0](https://github.com/minjinnn1/coffee-roasting-monitoring-system/releases/tag/v1.0.0)

### Demo Credentials

**Operator:** `operator` / `operator123`  
**Technologist:** `technologist` / `technologist123`

> The Windows demo uses simulated process data and does not require physical roasting equipment.

---

## Overview

The project simulates the operation of a coffee roasting monitoring and control system used in industrial production. It allows operators to monitor technological parameters in real time, compare measured values with recipe setpoints, detect deviations, adjust process controls, and manage roasting batches.

The original capstone architecture uses a Node.js/Express backend with a MySQL database, REST API, and WebSocket communication for real-time monitoring. A standalone Windows demo version was later developed using Electron and an embedded SQLite database, allowing the application to run without MySQL or additional database configuration.

The demo uses simulated process data to reproduce the behavior of the roasting process without requiring physical roasting equipment.

---

## Technologies

### Desktop Application

- Electron
- electron-builder
- NSIS

### Backend

- Node.js
- Express.js
- WebSocket (`ws`)
- REST API

### Databases

- MySQL — original capstone architecture
- SQLite (`better-sqlite3`) — standalone Windows demo

### Frontend

- HTML5
- CSS3
- JavaScript
- Chart.js

### Reporting

- XLSX batch report generation

### Development & Deployment

- Git
- GitHub
- Docker (optional)
- GitHub Releases

---

## Main Features

- User authentication and role-based access control
- Operator and Technologist user roles
- Real-time monitoring of roasting parameters
- Recipe-based roasting process simulation
- Recipe and roasting stage management
- Batch creation, monitoring, and history
- Real-time temperature and Rate of Rise (RoR) charts
- Heating power and airflow adjustment
- Alarm and process deviation detection
- Alarm acknowledgement
- System event and control action logging
- Historical process data storage
- XLSX batch report generation
- Persistent local data storage in the standalone demo

---

## Monitored Parameters

The system monitors the following technological parameters in real time:

- Inlet air temperature
- Outlet air temperature
- Bean temperature
- Rate of Rise (RoR)

Operators can adjust the following process controls:

- Heating power
- Airflow speed

---

## System Architecture

The project has two configurations: the original capstone architecture and a standalone Windows demo.

### Original Capstone Architecture

The original version was designed around a client-server architecture with MySQL for persistent data storage.

```text
Process Simulation
        │
        ▼
Node.js + Express Backend
        │
        ├── REST API
        ├── WebSocket
        │
        ▼
      MySQL
        │
        ▼
Web-based User Interface
```

The process simulation represents the roasting equipment and generates technological parameter values used for monitoring, control, alarms, and historical analysis.

### Standalone Windows Demo

The standalone version packages the system as a Windows desktop application using Electron and replaces the external MySQL database with an embedded SQLite database.

```text
Built-in Process Simulation
        │
        ▼
Node.js + Express Backend
        │
        ├── REST API
        ├── WebSocket
        │
        ▼
      SQLite
        │
        ▼
Electron Desktop Application
```

The SQLite database is created automatically on first launch and stores recipes, batches, measurements, alarms, logs, and other application data locally.

The standalone demo does not require MySQL, Node.js, SQLite, or additional database configuration to be installed separately.

---

## Screenshots

### Login

![Login](images/login.png)

### Dashboard

![Dashboard](images/dashboard.png)

### Recipe Management

![Recipes](images/recipes.png)

### Alarm Monitoring

![Alarms](images/alarms.png)

---

## System Architecture Diagram

![Architecture](images/architecture.jpg)

---

## Database Schema

![Database](images/database-schema.jpg)

---

## Repository Structure

```text
.
├── api/                # Backend, Electron entry point, SQLite runtime
├── assets/             # Frontend JavaScript and CSS
├── database/           # Original MySQL database schema/reference
├── images/             # README images
├── index.html
├── login.html
├── alarms.html
├── recipes.html
├── batches.html
├── logs.html
└── README.md
```

---

## Project Highlights

- Industrial process monitoring and control
- Relational database design
- REST API and WebSocket integration
- Real-time data visualization
- Recipe-driven process control
- Alarm and deviation management
- Role-based access control
- Standalone Electron desktop packaging
- Embedded SQLite persistence
- Automated XLSX batch reporting
