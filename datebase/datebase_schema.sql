-- MySQL dump 10.13  Distrib 8.0.40, for Win64 (x86_64)
--
-- Host: localhost    Database: roast
-- ------------------------------------------------------
-- Server version	8.4.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `batches`
--

DROP TABLE IF EXISTS `batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `batches` (
  `id_batches` int NOT NULL AUTO_INCREMENT,
  `batch_number` varchar(30) NOT NULL,
  `id_recipe` int NOT NULL,
  `id_user` int NOT NULL,
  `green_weight_in` decimal(6,2) NOT NULL,
  `coffee_variety` varchar(100) DEFAULT NULL,
  `target_roast_degree` enum('light','medium','dark') NOT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime DEFAULT NULL,
  `status` enum('active','completed','aborted') NOT NULL DEFAULT 'active',
  `notes` text,
  `roasted_weight_out` decimal(6,2) DEFAULT NULL,
  PRIMARY KEY (`id_batches`),
  UNIQUE KEY `uk_batch_number` (`batch_number`),
  KEY `idx_batches_status` (`status`),
  KEY `fk_batches_user` (`id_user`),
  KEY `fk_batches_recipe` (`id_recipe`),
  CONSTRAINT `fk_batches_recipe` FOREIGN KEY (`id_recipe`) REFERENCES `recipes` (`id_recipe`),
  CONSTRAINT `fk_batches_user` FOREIGN KEY (`id_user`) REFERENCES `users` (`id_user`)
) ENGINE=InnoDB AUTO_INCREMENT=132 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `control_actions_log`
--

DROP TABLE IF EXISTS `control_actions_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `control_actions_log` (
  `id_control_log` int NOT NULL AUTO_INCREMENT,
  `id_user` int DEFAULT NULL,
  `id_batches` int DEFAULT NULL,
  `id_parameters` int DEFAULT NULL,
  `old_value` double DEFAULT NULL,
  `new_value` double NOT NULL,
  `unit` varchar(20) DEFAULT NULL,
  `description` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_control_log`),
  KEY `idx_control_time` (`created_at`),
  KEY `idx_control_user` (`id_user`),
  KEY `idx_control_batch` (`id_batches`),
  KEY `idx_control_param` (`id_parameters`),
  CONSTRAINT `fk_control_batch` FOREIGN KEY (`id_batches`) REFERENCES `batches` (`id_batches`) ON DELETE SET NULL,
  CONSTRAINT `fk_control_param` FOREIGN KEY (`id_parameters`) REFERENCES `parameters` (`id_parameters`) ON DELETE SET NULL,
  CONSTRAINT `fk_control_user` FOREIGN KEY (`id_user`) REFERENCES `users` (`id_user`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `equipment`
--

DROP TABLE IF EXISTS `equipment`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `equipment` (
  `id_equipment` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `model` varchar(100) DEFAULT NULL,
  `type` enum('roaster','heater','fan','cooling_unit','control_unit') NOT NULL,
  `serial_number` varchar(100) DEFAULT NULL,
  `install_date` date DEFAULT NULL,
  `status` enum('operational','maintenance','failure') NOT NULL DEFAULT 'operational',
  PRIMARY KEY (`id_equipment`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `errors_log`
--

DROP TABLE IF EXISTS `errors_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `errors_log` (
  `id_error` int NOT NULL AUTO_INCREMENT,
  `id_batches` int DEFAULT NULL,
  `id_equipment` int DEFAULT NULL,
  `id_sensor` int DEFAULT NULL,
  `id_parameters` int DEFAULT NULL,
  `error_type` enum('setpoint_deviation','sensor_range','sensor_offline','equipment_failure','emergency_stop','system_error') NOT NULL,
  `description` text NOT NULL,
  `actual_value` double DEFAULT NULL,
  `expected_value` double DEFAULT NULL,
  `severity` enum('info','warning','critical') NOT NULL,
  `is_acknowledged` tinyint(1) NOT NULL DEFAULT '0',
  `acknowledged_by` int DEFAULT NULL,
  `acknowledged_at` datetime DEFAULT NULL,
  `timestamp` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id_error`),
  KEY `id_batches` (`id_batches`),
  KEY `id_equipment` (`id_equipment`),
  KEY `id_sensor` (`id_sensor`),
  KEY `fk_errors_param` (`id_parameters`),
  KEY `fk_errors_user` (`acknowledged_by`),
  KEY `idx_unack` (`is_acknowledged`,`timestamp`),
  CONSTRAINT `errors_log_ibfk_1` FOREIGN KEY (`id_batches`) REFERENCES `batches` (`id_batches`),
  CONSTRAINT `errors_log_ibfk_2` FOREIGN KEY (`id_equipment`) REFERENCES `equipment` (`id_equipment`),
  CONSTRAINT `errors_log_ibfk_3` FOREIGN KEY (`id_sensor`) REFERENCES `sensors` (`id_sensor`),
  CONSTRAINT `fk_errors_param` FOREIGN KEY (`id_parameters`) REFERENCES `parameters` (`id_parameters`),
  CONSTRAINT `fk_errors_user` FOREIGN KEY (`acknowledged_by`) REFERENCES `users` (`id_user`)
) ENGINE=InnoDB AUTO_INCREMENT=519 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;


--
-- Table structure for table `measured_values`
--

DROP TABLE IF EXISTS `measured_values`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `measured_values` (
  `id_values` int NOT NULL AUTO_INCREMENT,
  `id_batches` int NOT NULL,
  `id_parameters` int NOT NULL,
  `value` double NOT NULL,
  `timestamp` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id_values`),
  KEY `idx_mv_batch` (`id_batches`),
  KEY `idx_mv_param` (`id_parameters`),
  CONSTRAINT `measured_values_ibfk_1` FOREIGN KEY (`id_batches`) REFERENCES `batches` (`id_batches`) ON DELETE CASCADE,
  CONSTRAINT `measured_values_ibfk_2` FOREIGN KEY (`id_parameters`) REFERENCES `parameters` (`id_parameters`)
) ENGINE=InnoDB AUTO_INCREMENT=270552 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;


--
-- Table structure for table `parameters`
--

DROP TABLE IF EXISTS `parameters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `parameters` (
  `id_parameters` int NOT NULL,
  `code` varchar(20) NOT NULL DEFAULT '',
  `name` varchar(45) NOT NULL,
  `unit` varchar(45) NOT NULL,
  `min_value` double NOT NULL DEFAULT '0',
  `max_value` double NOT NULL DEFAULT '0',
  `is_calculated` tinyint(1) NOT NULL DEFAULT '0',
  `is_controllable` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id_parameters`),
  UNIQUE KEY `uk_parameters_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `process_state`
--

DROP TABLE IF EXISTS `process_state`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `process_state` (
  `id` int NOT NULL,
  `is_running` tinyint(1) NOT NULL DEFAULT '0',
  `active_batch_id` int DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_ps_batch` (`active_batch_id`),
  CONSTRAINT `fk_ps_batch` FOREIGN KEY (`active_batch_id`) REFERENCES `batches` (`id_batches`) ON DELETE SET NULL,
  CONSTRAINT `process_state_chk_1` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `recipe_setpoints`
--

DROP TABLE IF EXISTS `recipe_setpoints`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recipe_setpoints` (
  `id_setpoint` int NOT NULL AUTO_INCREMENT,
  `id_recipe` int NOT NULL,
  `id_parameters` int NOT NULL,
  `id_stage` int DEFAULT NULL,
  `time_offset_sec` int NOT NULL,
  `target_value` double NOT NULL,
  `tolerance` double NOT NULL DEFAULT '5',
  PRIMARY KEY (`id_setpoint`),
  UNIQUE KEY `uk_setpoint` (`id_recipe`,`id_parameters`,`time_offset_sec`),
  KEY `id_parameters` (`id_parameters`),
  KEY `fk_setpoints_stage` (`id_stage`),
  CONSTRAINT `recipe_setpoints_ibfk_1` FOREIGN KEY (`id_recipe`) REFERENCES `recipes` (`id_recipe`),
  CONSTRAINT `recipe_setpoints_ibfk_2` FOREIGN KEY (`id_parameters`) REFERENCES `parameters` (`id_parameters`),
  CONSTRAINT `chk_sp_target` CHECK ((`target_value` >= 0)),
  CONSTRAINT `chk_sp_time` CHECK ((`time_offset_sec` >= 0)),
  CONSTRAINT `chk_sp_tolerance` CHECK ((`tolerance` >= 0))
) ENGINE=InnoDB AUTO_INCREMENT=207 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `recipe_stages`
--

DROP TABLE IF EXISTS `recipe_stages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recipe_stages` (
  `id_stage` int NOT NULL AUTO_INCREMENT,
  `id_recipe` int NOT NULL,
  `id_stage_type` int DEFAULT NULL,
  `stage_name` varchar(100) NOT NULL,
  `start_time_sec` int NOT NULL,
  `end_time_sec` int NOT NULL,
  PRIMARY KEY (`id_stage`),
  UNIQUE KEY `uk_recipe_stage` (`id_recipe`,`id_stage_type`),
  KEY `fk_recipe_stages_stage_type` (`id_stage_type`),
  KEY `idx_recipe_stages_recipe` (`id_recipe`),
  CONSTRAINT `fk_recipe_stages_stage_type` FOREIGN KEY (`id_stage_type`) REFERENCES `stage_types` (`id_stage_type`),
  CONSTRAINT `fk_stages_recipe` FOREIGN KEY (`id_recipe`) REFERENCES `recipes` (`id_recipe`) ON DELETE CASCADE,
  CONSTRAINT `chk_stage_start` CHECK ((`start_time_sec` >= 0)),
  CONSTRAINT `chk_stage_time` CHECK ((`end_time_sec` > `start_time_sec`))
) ENGINE=InnoDB AUTO_INCREMENT=67 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `recipes`
--

DROP TABLE IF EXISTS `recipes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recipes` (
  `id_recipe` int NOT NULL AUTO_INCREMENT,
  `recipe_name` varchar(100) NOT NULL,
  `roast_degree` enum('light','medium','dark') NOT NULL,
  `total_duration_sec` int NOT NULL,
  `target_weight_kg` decimal(6,2) NOT NULL,
  `description` text,
  `created_by` int NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id_recipe`),
  UNIQUE KEY `uk_recipes_name` (`recipe_name`),
  KEY `fk_recipes_user` (`created_by`),
  CONSTRAINT `fk_recipes_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id_user`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sensors`
--

DROP TABLE IF EXISTS `sensors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sensors` (
  `id_sensor` int NOT NULL AUTO_INCREMENT,
  `id_equipment` int NOT NULL,
  `id_parameters` int NOT NULL,
  `sensor_type` enum('thermocouple','pressure_sensor','frequency_converter','power_regulator','calculated') DEFAULT NULL,
  `sensor_name` varchar(50) NOT NULL,
  `serial_number` varchar(100) DEFAULT NULL,
  `min_range` double NOT NULL DEFAULT '0',
  `max_range` double NOT NULL DEFAULT '0',
  `accuracy_value` double DEFAULT NULL,
  `accuracy_unit` enum('°C','%','кВт','м/с','°C/мин') DEFAULT NULL,
  `status` enum('operational','maintenance','failure') NOT NULL DEFAULT 'operational',
  PRIMARY KEY (`id_sensor`),
  KEY `id_equipment` (`id_equipment`),
  KEY `id_parameters` (`id_parameters`),
  CONSTRAINT `sensors_ibfk_1` FOREIGN KEY (`id_equipment`) REFERENCES `equipment` (`id_equipment`),
  CONSTRAINT `sensors_ibfk_2` FOREIGN KEY (`id_parameters`) REFERENCES `parameters` (`id_parameters`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `stage_types`
--

DROP TABLE IF EXISTS `stage_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `stage_types` (
  `id_stage_type` int NOT NULL AUTO_INCREMENT,
  `stage_code` varchar(50) NOT NULL,
  `stage_name` varchar(100) NOT NULL,
  `description` text,
  `sort_order` int NOT NULL,
  PRIMARY KEY (`id_stage_type`),
  UNIQUE KEY `uk_stage_types_code` (`stage_code`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_events_log`
--

DROP TABLE IF EXISTS `system_events_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_events_log` (
  `id_event` int NOT NULL AUTO_INCREMENT,
  `event_type` enum('login','logout','batch_start','batch_stop','recipe_create','recipe_update','recipe_deactivate','alarm_ack','report_generated','simulation_deviation') NOT NULL,
  `id_user` int DEFAULT NULL,
  `id_batches` int DEFAULT NULL,
  `id_recipe` int DEFAULT NULL,
  `description` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id_event`),
  KEY `idx_events_time` (`created_at`),
  KEY `idx_events_user` (`id_user`),
  KEY `idx_events_batch` (`id_batches`),
  KEY `idx_events_recipe` (`id_recipe`),
  KEY `idx_events_type` (`event_type`),
  CONSTRAINT `fk_events_batch` FOREIGN KEY (`id_batches`) REFERENCES `batches` (`id_batches`) ON DELETE SET NULL,
  CONSTRAINT `fk_events_recipe` FOREIGN KEY (`id_recipe`) REFERENCES `recipes` (`id_recipe`) ON DELETE SET NULL,
  CONSTRAINT `fk_events_user` FOREIGN KEY (`id_user`) REFERENCES `users` (`id_user`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=164 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;


--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id_user` int NOT NULL AUTO_INCREMENT,
  `login` varchar(32) NOT NULL,
  `user_name` varchar(45) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `role` enum('operator','technologist') NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `email` varchar(45) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login` datetime(1) DEFAULT NULL,
  PRIMARY KEY (`id_user`),
  UNIQUE KEY `login` (`login`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;


/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-04 18:22:24
