-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Jul 08, 2026 at 10:13 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `rmnkuuby_ai`
--

-- --------------------------------------------------------

--
-- Table structure for table `agent_branches`
--

CREATE TABLE `agent_branches` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ai_replies`
--

CREATE TABLE `ai_replies` (
  `id` varchar(36) NOT NULL,
  `review_id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `reply` text NOT NULL,
  `posted` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audit_reports`
--

CREATE TABLE `audit_reports` (
  `id` varchar(36) NOT NULL,
  `business_id` varchar(36) NOT NULL,
  `score` int(11) NOT NULL,
  `report_data` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `branches`
--

CREATE TABLE `branches` (
  `id` varchar(36) NOT NULL,
  `business_id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `address` text DEFAULT NULL,
  `qr_code` text DEFAULT NULL,
  `public_slug` varchar(255) NOT NULL,
  `low_rating_threshold` int(11) NOT NULL DEFAULT 3,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `branches`
--

INSERT INTO `branches` (`id`, `business_id`, `name`, `address`, `qr_code`, `public_slug`, `low_rating_threshold`, `created_at`) VALUES
('cd73f7f7-884b-4808-8739-5fe0292c7319', '4351099d-2207-485e-8b4a-b68c1ae6331e', 'Jaipur', 'Jaipur', 'data:image/png;base64,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', 'tfgv6hk2xt', 3, '2026-07-08 07:29:10');

-- --------------------------------------------------------

--
-- Table structure for table `businesses`
--

CREATE TABLE `businesses` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `industry` text DEFAULT NULL,
  `google_place_id` text DEFAULT NULL,
  `google_review_url` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `businesses`
--

INSERT INTO `businesses` (`id`, `user_id`, `name`, `industry`, `google_place_id`, `google_review_url`, `created_at`) VALUES
('4351099d-2207-485e-8b4a-b68c1ae6331e', 'aadb2f02-3dca-4350-a712-6b22fb963478', 'Test', 'Detailling studio', NULL, 'https://g.page/r/CTvKKKEtVdC2EBM/review', '2026-07-08 07:28:44');

-- --------------------------------------------------------

--
-- Table structure for table `contact_messages`
--

CREATE TABLE `contact_messages` (
  `id` varchar(36) NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `message` text NOT NULL,
  `plan` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reviews`
--

CREATE TABLE `reviews` (
  `id` varchar(36) NOT NULL,
  `branch_id` varchar(36) NOT NULL,
  `customer_name` text DEFAULT NULL,
  `customer_email` text DEFAULT NULL,
  `rating` int(11) NOT NULL,
  `content` text DEFAULT NULL,
  `ai_generated` tinyint(1) NOT NULL DEFAULT 0,
  `status` enum('pending','public','private','ignored') NOT NULL DEFAULT 'public',
  `google_review_link` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `subscriptions`
--

CREATE TABLE `subscriptions` (
  `id` varchar(36) NOT NULL,
  `user_id` varchar(36) NOT NULL,
  `plan` enum('silver','gold','platinum') NOT NULL DEFAULT 'silver',
  `ai_tokens_used` int(11) NOT NULL,
  `ai_tokens_limit` int(11) NOT NULL DEFAULT 10000,
  `max_branches` int(11) NOT NULL DEFAULT 2,
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `stripe_customer_id` varchar(255) DEFAULT NULL,
  `stripe_subscription_id` varchar(255) DEFAULT NULL,
  `stripe_price_id` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` varchar(36) NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `full_name` text NOT NULL,
  `phone` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `role` enum('admin','owner','agent') NOT NULL DEFAULT 'owner'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `email`, `password_hash`, `full_name`, `phone`, `created_at`, `role`) VALUES
('aadb2f02-3dca-4350-a712-6b22fb963478', 'sudhanshumauryaspn@gmail.com', '$2b$10$JbX5o2Xvt1qt83RNoWdmNey6Dv8bBt0jmr5P.4aBEtOPO2fFcsyfK', 'sudhanshu ', NULL, '2026-07-03 06:20:48', 'admin'),
('aadb2f02-3dca-4350-a712-6b22fb963479', 'sudhanshumauryaspn1@gmail.com', '$2b$10$JbX5o2Xvt1qt83RNoWdmNey6Dv8bBt0jmr5P.4aBEtOPO2fFcsyfK', 'sudhanshu ', NULL, '2026-07-03 06:20:48', 'agent'),
('aadb2f02-3dca-4350-a712-6b22fb963480', 'sudhanshumauryaspn2@gmail.com', '$2b$10$JbX5o2Xvt1qt83RNoWdmNey6Dv8bBt0jmr5P.4aBEtOPO2fFcsyfK', 'sudhanshu ', NULL, '2026-07-03 06:20:48', 'owner');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `agent_branches`
--
ALTER TABLE `agent_branches`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `agent_branch_idx` (`user_id`,`branch_id`);

--
-- Indexes for table `ai_replies`
--
ALTER TABLE `ai_replies`
  ADD PRIMARY KEY (`id`),
  ADD KEY `ai_replies_review_id_reviews_id_fk` (`review_id`),
  ADD KEY `ai_replies_user_id_users_id_fk` (`user_id`);

--
-- Indexes for table `audit_reports`
--
ALTER TABLE `audit_reports`
  ADD PRIMARY KEY (`id`),
  ADD KEY `audit_reports_business_id_businesses_id_fk` (`business_id`);

--
-- Indexes for table `branches`
--
ALTER TABLE `branches`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `branches_slug_idx` (`public_slug`),
  ADD KEY `branches_business_idx` (`business_id`);

--
-- Indexes for table `businesses`
--
ALTER TABLE `businesses`
  ADD PRIMARY KEY (`id`),
  ADD KEY `businesses_user_idx` (`user_id`);

--
-- Indexes for table `contact_messages`
--
ALTER TABLE `contact_messages`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `reviews`
--
ALTER TABLE `reviews`
  ADD PRIMARY KEY (`id`),
  ADD KEY `reviews_branch_idx` (`branch_id`),
  ADD KEY `reviews_status_idx` (`status`);

--
-- Indexes for table `subscriptions`
--
ALTER TABLE `subscriptions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `subscriptions_user_id_users_id_fk` (`user_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `users_email_idx` (`email`) USING HASH,
  ADD KEY `users_role_idx` (`role`);

--
-- Constraints for dumped tables
--

--
-- Constraints for table `ai_replies`
--
ALTER TABLE `ai_replies`
  ADD CONSTRAINT `ai_replies_review_id_reviews_id_fk` FOREIGN KEY (`review_id`) REFERENCES `reviews` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT `ai_replies_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

--
-- Constraints for table `audit_reports`
--
ALTER TABLE `audit_reports`
  ADD CONSTRAINT `audit_reports_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

--
-- Constraints for table `branches`
--
ALTER TABLE `branches`
  ADD CONSTRAINT `branches_business_id_businesses_id_fk` FOREIGN KEY (`business_id`) REFERENCES `businesses` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

--
-- Constraints for table `businesses`
--
ALTER TABLE `businesses`
  ADD CONSTRAINT `businesses_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

--
-- Constraints for table `reviews`
--
ALTER TABLE `reviews`
  ADD CONSTRAINT `reviews_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

--
-- Constraints for table `subscriptions`
--
ALTER TABLE `subscriptions`
  ADD CONSTRAINT `subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
