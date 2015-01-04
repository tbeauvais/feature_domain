require 'sinatra'
require 'rack/test'
require 'fakeredis'
require 'fakeredis/rspec'

$LOAD_PATH.unshift(File.join(File.dirname(__FILE__), '..', 'lib'))
$LOAD_PATH.unshift(File.join(File.dirname(__FILE__), '..'))

require 'app'

# setup test environment
set :environment, :test
set :run, false
set :raise_errors, true
set :logging, false


RSpec.configure do |config|
  config.color = true
  config.include Rack::Test::Methods

  config.before do
    Redis::Connection::Memory.reset_all_databases
  end

  module SecureRandom
    def self.uuid
      '384fb29b-c53f-4d71-8498-a35e8a7321a4'
    end
  end

end

def app
  App
end

