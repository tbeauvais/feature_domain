require 'json'
require 'redis'

class RedisConnection

  def self.client
    Redis.new(host: credentials['hostname'], port: credentials['port'], password: credentials['password'], name: credentials['name'])
  end

  private

  def self.credentials
    credentials = {'credentials'=>{'port'=>'6379', 'hostname'=>'localhost', 'password'=>''}}
    if ENV['VCAP_SERVICES']
      services = JSON.parse(ENV['VCAP_SERVICES'])
      $stderr.puts "VCAP_SERVICES: #{services}"
      redis_service = services['redis']
      redis_service = services['rediscloud'] unless redis_service
      redis_service = services['redis-2.6'] unless redis_service
      credentials = redis_service.first['credentials'] if redis_service
    end
    credentials
  rescue Exception => e
    $stderr.puts 'Error in config'
    $stderr.puts "Error: #{e.message}"
  end

end
