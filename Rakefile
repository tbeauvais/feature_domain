require 'jasmine'
require 'coffee-script'
require 'fileutils'
load 'jasmine/tasks/jasmine.rake'

APP_FILE  = 'app.rb'
APP_CLASS = 'App'
require 'sinatra/assetpack/rake'


namespace :specs do
  desc "Runs Jasmine JS specs from browser"
  task :server do
    system 'rake assets:clean'
    system 'rake assetpack:build'
    system 'rake jasmine'
  end
end

namespace :specs do
  desc 'Runs Jasmine JS specs headless'
  task :ci do
    system 'rake assets:clean'
    system 'rake assetpack:build'
    system 'rake jasmine:ci'
  end
end

namespace :assets do
  desc 'Cleans output from assetpack:build'
  task :clean do
    root = File.dirname(__FILE__)
    Dir.glob(File.join(root, 'public')).each do |f|
      puts "Deleting #{f}"
      if File.directory?(f)
        FileUtils.rm_rf(f)
      end
    end
  end
end

namespace :app do
  desc 'Runs application'
  task :run do
    system 'rake assets:clean'
    system 'rackup -p 4567'
  end
end



